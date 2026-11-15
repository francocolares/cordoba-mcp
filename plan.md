# Plan: Scraper + MCP de la Agenda Turística de Córdoba

> Documento para usar con Claude Code. Copialo en la raíz de un repo vacío y pedile:
> "Implementá PLAN.md fase por fase. Al terminar cada fase corré los tests y verificá los criterios de aceptación antes de seguir."

## 0. Contexto (descubierto el 2026-11-12)

- La página pública es `https://turismo.cordoba.gob.ar/agenda-turistica/`. Un evento individual se ve en `?evento=N`.
- `robots.txt` (generado por Yoast) no restringe nada: `User-agent: *` / `Disallow:` (vacío).
- La agenda es una app de Angular embebida en WordPress. La carga este script:
  `https://documentos.cordoba.gob.ar/MUNCBA/plugins/agenda-cultura/main.js?a=1`
  (además se cargan `polyfills.js`, `runtime.js` y `scripts.js` desde la misma carpeta).
- La app obtiene **todos** los eventos de una única Google Sheet pública, vía el endpoint gviz:
  `https://docs.google.com/spreadsheets/d/1RUZ_OOHkx2-xwg9UfzPMiEMv4pXEdJMZcXxbhk665Nw/gviz/tq?tqx=out:json`
- La respuesta gviz **no es JSON puro**. Viene envuelta así:
  `/*O_o*/\ngoogle.visualization.Query.setResponse({...});`
  Para parsearla hay que tomar lo que va desde el primer `{` hasta el último `}`.
- Columnas actuales, en orden:
  `fecha_ini, Hora, Fecha_fin, Hora_fin, Nombre, Tipo de Evento, Descripción, Lugar, Organizador, Inscripción, Precio, Estado, Permanente, Horarios Permanente, Imagen`
- Cada celda es `{v, f}` o `null`. Hay que usar `f` (valor formateado) si existe y si no `v`. Las fechas pueden venir como `"Date(2026,10,29)"` en `v`, con el **mes base 0**, y como `"29/11/2026"` en `f`. Hay que soportar ambos formatos.
- `?evento=N` es el **índice de fila (base 0)** de la planilla, no un ID estable. Verificado: la fila 55 es "Polenta Pop". Las filas viejas se borran, así que los índices se corren.
- Datos sucios observados:
  - `Tipo de Evento` es texto libre, con unas 25 variantes ("Humor / Stand-up", "Humor / Stand up", "Teatro " con espacio final, etc.).
  - `Precio` toma los valores `"0"` (gratis), `"Con costo"` o `"Comprá tu entrada en “Inscribite”"`. No hay montos.
  - `Estado` hoy vale siempre `"1"`.
  - `Permanente` hoy está vacío en todas las filas.
- La zona horaria es America/Argentina/Cordoba (UTC-3, sin horario de verano).

## 1. Alcance

**Incluido**
1. Un scraper que baja la planilla, normaliza los eventos y los persiste con histórico.
2. Un validador que confirma que la página sigue usando la misma planilla y que el esquema de columnas no cambió.
3. Una GitHub Action diaria que corre el validador y el scraper y commitea los datos (patrón "git scraping").
4. El scaffolding de un servidor MCP (stdio) que expone los eventos, configurado para Claude Code.

**Fuera de alcance (por ahora)**
- Otras fuentes (Alpogo, Agencia Córdoba Cultura, PDFs municipales). Igual hay que dejar una interfaz `Source` para sumarlas después.
- Geocodificación de lugares.
- Deduplicación entre fuentes.
- Despliegue remoto del MCP (HTTP/SSE).

## 2. Stack y decisiones

- **Python 3.12** con **uv** como gestor de paquetes. Dependencias: `httpx`, `pydantic>=2`, `mcp` (SDK oficial, se usa `FastMCP`).
- Dependencias de desarrollo: `pytest`, `pytest-httpx` (o `respx`) y `ruff`.
- **Persistencia en archivos de texto, commiteados al repo**, para que los diffs se puedan leer:
  - `data/raw/YYYY-MM-DD.json`: la respuesta gviz cruda (ya desenvuelta), una por día.
  - `data/events.jsonl`: el estado canónico, con un evento por línea ordenado por `id`. Incluye eventos que ya no están en la fuente, marcados con `active=false`.
  - `data/changes.jsonl`: log append-only de altas, bajas y modificaciones.
  - `data/status.json`: resultado del último run (timestamp, validador ok/fail, cantidad de eventos, hash del esquema).
- **ID propio estable:** `sha1(normalize(nombre) + "|" + fecha_ini_iso + "|" + normalize(lugar))[:12]`. `normalize` pasa a minúsculas, quita tildes y colapsa los espacios. El índice de fila se guarda como `source_row`, solo informativo.
- El MCP lee `data/events.jsonl` desde la ruta local o desde una URL raw de GitHub, según la variable `AGENDA_DATA_URL`. Si la variable está definida usa la URL; si no, lee el archivo local.

## 3. Estructura del repo

```
.
├── PLAN.md
├── pyproject.toml
├── .mcp.json                      # config del MCP para Claude Code
├── .github/workflows/scrape.yml
├── src/agenda_cba/
│   ├── __init__.py
│   ├── config.py                  # URLs, sheet ID esperado, columnas esperadas, TZ
│   ├── models.py                  # Event, RawRow, ChangeRecord, RunStatus (pydantic)
│   ├── gviz.py                    # fetch + unwrap + parse de la respuesta gviz
│   ├── normalize.py               # fechas, horas, precio, categoría, id
│   ├── categories.py              # mapeo de "Tipo de Evento" a categoría canónica
│   ├── store.py                   # leer/escribir events.jsonl, changes.jsonl, raw, status
│   ├── validate.py                # validador de fuente (sheet ID + esquema)
│   ├── sources/
│   │   ├── base.py                # Protocol Source: fetch() -> list[Event]
│   │   └── turismo_muni.py        # implementación para esta planilla
│   ├── cli.py                     # `agenda-cba validate|scrape|run`
│   └── mcp_server.py              # servidor FastMCP
└── tests/
    ├── fixtures/
    │   ├── gviz_response.txt      # respuesta real envuelta (capturar en la fase 1)
    │   ├── agenda_page.html       # HTML de la página (capturar)
    │   └── main.js                # bundle con el sheet ID (capturar o recortar)
    ├── test_gviz.py
    ├── test_normalize.py
    ├── test_store.py
    ├── test_validate.py
    └── test_mcp.py
```

## 4. Fases

### Fase 1: Parsing de gviz y modelo

1. En `config.py`:
   - `SHEET_ID = "1RUZ_OOHkx2-xwg9UfzPMiEMv4pXEdJMZcXxbhk665Nw"`
   - `GVIZ_URL` (armada a partir de `SHEET_ID`)
   - `AGENDA_URL`
   - `EXPECTED_COLUMNS` (la lista de la sección 0)
   - `TZ = "America/Argentina/Cordoba"`
   - `USER_AGENT = "agenda-cba-scraper/0.1 (+https://github.com/<user>/<repo>)"`
2. En `gviz.py`:
   - `fetch_gviz() -> str`: httpx con timeout de 30 s, 3 reintentos con backoff y el User-Agent propio.
   - `unwrap(text) -> dict`: falla con un error claro si `status != "ok"`.
   - `rows(payload) -> list[dict[str, str|None]]`: mapea por label de columna y prioriza `f` sobre `v`.
3. En `models.py`, definir `Event` con estos campos:
   - `id`, `source="turismo_muni"`, `source_row`
   - `title`, `description`
   - `category_raw`, `category`
   - `start` (datetime con TZ), `end` (datetime con TZ o null)
   - `venue`, `organizer`, `ticket_url`
   - `price_type` (`gratis | pago | desconocido`), `price_raw`
   - `is_permanent`, `permanent_schedule`
   - `image_url`, `status_raw`
   - `active`, `first_seen`, `last_seen`, `content_hash`
4. Capturar fixtures reales (`curl` de la URL gviz) en `tests/fixtures/`.

**Aceptación**
- `test_gviz.py` parsea el fixture y obtiene más de 0 filas, con exactamente las 15 columnas esperadas.
- `unwrap` levanta una excepción si el texto está corrupto o si `status` es `"error"`.

### Fase 2: Normalización

1. Fechas:
   - Parsear `dd/mm/aaaa` y `Date(y,m,d)` (con `m` base 0).
   - Hora `HH:mm`, o vacía (en ese caso queda 00:00 y se marca `all_day=True`).
   - Si la hora de fin es menor que la de inicio y la fecha de fin coincide con la de inicio, sumar un día a la fecha de fin (shows que cruzan la medianoche).
2. Precio:
   - `"0"` o cualquier texto que contenga "gratis"/"libre" → `gratis`.
   - `"Con costo"`, o un `ticket_url` presente → `pago`.
   - Cualquier otro caso → `desconocido`.
3. Categorías:
   - Hacer un `strip()` y bajar a minúsculas.
   - Mapear a un set canónico chico: `musica, teatro, humor, danza, infantil, visita_guiada, museos_cultura, feria, conferencia, fiesta, streaming, gastronomia, otro`.
   - Usar un dict de keywords. Lo que no matchee va a `otro` y se loguea un warning.
4. `id` y `content_hash`. El hash es sha1 de los campos normalizados excluyendo `first_seen`, `last_seen`, `active` y `source_row`.

**Aceptación**
- Hay tests parametrizados para cada variante de categoría observada, para la medianoche cruzada, para la fecha en formato `Date(...)` y para los 3 tipos de precio.
- `ruff check` corre limpio.

### Fase 3: Store con histórico

1. `store.load_events()` / `store.save_events()` sobre `data/events.jsonl`, ordenado por `id` para que los diffs sean estables.
2. `store.merge(previous, scraped, now)`:
   - **Alta:** un id nuevo recibe `first_seen=last_seen=now` y `active=true`, y genera un registro `added`.
   - **Sigue presente:** se actualiza `last_seen`. Si cambió el `content_hash`, se actualizan los campos y se registra `updated` con un diff de campos.
   - **Ya no está en la fuente:** pasa a `active=false` y se registra `removed`, una sola vez.
   - Un evento que vuelve a aparecer se pone `active=true` y se registra `readded`.
3. Guardar el snapshot crudo en `data/raw/YYYY-MM-DD.json`. Si ya existe uno ese día, se sobrescribe.
4. Escribir `data/status.json`.

**Aceptación**
- Hay tests de `merge` con 3 snapshots sintéticos que cubren alta, update, remove y readd.
- Correr `scrape` dos veces seguidas con los mismos datos no genera cambios en `events.jsonl` (salvo `last_seen`) ni registros nuevos en `changes.jsonl`.

### Fase 4: Validador de fuente

`validate.py` expone `validate_source() -> ValidationResult` y corre estas verificaciones, en orden:

1. **La página responde:** un GET a `AGENDA_URL` devuelve 200.
2. **El bundle sigue en la página:**
   - Buscar en el HTML el `<script src=...>` que contenga `agenda-cultura/main.js`.
   - Si no está, se registra el **FAIL** `bundle_missing`.
3. **El sheet ID sigue siendo el mismo:**
   - Bajar el `main.js` encontrado y extraer IDs con la regex `docs\.google\.com/spreadsheets/d/([a-zA-Z0-9_-]{30,})`.
   - Si el ID no aparece literal, extraer también candidatos con `([a-zA-Z0-9_-]{44})` cerca de las palabras `spreadsheets`/`gviz`.
   - Si `SHEET_ID` no está entre los IDs encontrados, es **FAIL** `sheet_id_changed`. El resultado debe reportar los IDs nuevos.
   - Si no se encuentra ningún ID, es **WARN** `sheet_id_not_found_in_bundle`. Puede que el bundle lo construya dinámicamente; en ese caso se sigue con la verificación 4.
4. **El esquema de la planilla no cambió:**
   - Bajar el gviz y comparar los labels con `EXPECTED_COLUMNS`.
   - Si cambian columnas, es **FAIL** `schema_changed`, con el diff de columnas.
   - Si la planilla tiene 0 filas, es **WARN** `empty_sheet`.
5. Guardar en `status.json` el sha256 del `main.js` (`bundle_hash`). Si cambió respecto del run anterior pero el ID sigue igual, es **INFO** `bundle_changed`.

Reglas de ejecución:
- El CLI `agenda-cba validate` devuelve exit code `0` si el resultado es ok o warn, y `1` si hay algún fail. Imprime el resultado en JSON.
- `agenda-cba run` ejecuta validate y después scrape. **Si hay un FAIL, no ejecuta el scrape**, para no marcar todos los eventos como `removed` por un cambio de fuente.

Notas:
- `main.js` está en otro dominio (`documentos.cordoba.gob.ar`). Desde el navegador falla por CORS, pero desde Python no hay problema.
- El sitio tiene Wordfence. Hay que usar el User-Agent propio, sin paralelismo. Si devuelve 403/503, reintentar una vez y reportar `page_blocked` como WARN, sin FAIL. En ese caso igual se valida el esquema vía gviz.

**Aceptación**
- Hay tests con los fixtures: el HTML y el bundle originales dan ok.
- Un bundle con otro ID da FAIL `sheet_id_changed`.
- Un gviz con una columna renombrada da FAIL `schema_changed`.
- Si el HTML no tiene el script, da FAIL `bundle_missing`.

### Fase 5: GitHub Action

Archivo `.github/workflows/scrape.yml`:

````yaml
name: scrape-agenda
on:
  schedule:
    - cron: "17 9 * * *" # 06:17 hora de Córdoba (UTC-3); minuto no redondo a propósito
  workflow_dispatch:
permissions:
  contents: write
  issues: write
concurrency:
  group: scrape-agenda
  cancel-in-progress: false
jobs:
  scrape:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
      - run: uv sync --frozen
      - run: uv run pytest -q
      - id: validate
        run: uv run agenda-cba validate > validation.json
      - if: failure() && steps.validate.outcome == 'failure'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const body = fs.existsSync('validation.json') ? fs.readFileSync('validation.json','utf8') : 'sin salida';
            const title = 'Fuente de agenda cambió o falló la validación';
            const open = await github.rest.issues.listForRepo({owner: context.repo.owner, repo: context.repo.repo, state: 'open', labels: 'scraper-alert'});
            if (!open.data.some(i => i.title === title)) {
              await github.rest.issues.create({owner: context.repo.owner, repo: context.repo.repo, title, labels: ['scraper-alert'], body: '```json\n' + body + '\n```'});
            }
      - run: uv run agenda-cba scrape
      - name: Commit data
        run: |
          git config user.name "agenda-bot"
          git config user.email "agenda-bot@users.noreply.github.com"
          git add data/
          git diff --cached --quiet || git commit -m "data: agenda $(date -u +%F)"
          git push
````

Puntos a cuidar:
- Si `validate` falla, el job se corta antes del scrape y se abre **un solo** issue (no uno por día).
- El primer run se hace a mano con `workflow_dispatch`.
- GitHub desactiva los workflows programados después de 60 días sin actividad en el repo. Los commits diarios de datos lo mantienen activo.

**Aceptación**
- `act` (opcional) o un `workflow_dispatch` manual termina en verde y deja un commit en `data/`.
- Con un `SHEET_ID` falso en una rama de prueba, se abre el issue y no hay commit.

### Fase 6: Servidor MCP

`src/agenda_cba/mcp_server.py` con `FastMCP("agenda-cordoba")` y transporte stdio. Los datos se cargan con cache en memoria y TTL de 10 minutos.

Tools (todas devuelven JSON con campos acotados y `description` truncada a 300 caracteres, salvo en `get_event`):

| Tool              | Parámetros                                                                                                                                     | Devuelve                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `search_events`   | `query?: str`, `category?: str`, `date_from?: date`, `date_to?: date`, `free_only?: bool=false`, `include_past?: bool=false`, `limit?: int=20` | Eventos activos que matchean (búsqueda sin tildes en título, descripción y lugar), ordenados por `start`                                  |
| `events_on`       | `date: str` (ISO, `"hoy"` o `"mañana"`)                                                                                                        | Eventos de ese día en hora de Córdoba                                                                                                     |
| `this_weekend`    | —                                                                                                                                              | Eventos del viernes 18:00 al domingo 23:59 próximos                                                                                       |
| `get_event`       | `id: str`                                                                                                                                      | Evento completo, más el link `https://turismo.cordoba.gob.ar/agenda-turistica/` (no se arma el link con `?evento=N` porque no es estable) |
| `list_categories` | —                                                                                                                                              | Categorías canónicas con la cantidad de eventos activos de cada una                                                                       |
| `source_status`   | —                                                                                                                                              | Contenido de `status.json`: último run, resultado de la validación y conteos                                                              |

Resource: `agenda://status` (lo mismo que `source_status`).

Otros requisitos:
- Todas las fechas se interpretan y devuelven en `America/Argentina/Cordoba`.
- Cada respuesta incluye `"source": "Agenda Turística – Municipalidad de Córdoba"` y `"data_as_of"`.
- Agregar el script `agenda-cba-mcp = "agenda_cba.mcp_server:main"` en `pyproject.toml`.

`.mcp.json` en la raíz:

```json
{
  "mcpServers": {
    "agenda-cordoba": {
      "command": "uv",
      "args": ["run", "--directory", ".", "agenda-cba-mcp"],
      "env": {
        "AGENDA_DATA_PATH": "data/events.jsonl"
      }
    }
  }
}
```

Para usarlo desde otra máquina sin clonar, se define `AGENDA_DATA_URL=https://raw.githubusercontent.com/<user>/<repo>/main/data/events.jsonl` en lugar de `AGENDA_DATA_PATH`.

**Aceptación**
- `test_mcp.py` llama a las funciones de cada tool directamente con un `events.jsonl` de fixture y verifica filtros, TZ y orden.
- `npx @modelcontextprotocol/inspector uv run agenda-cba-mcp` lista las 6 tools y `search_events` responde.
- En Claude Code, `/mcp` muestra `agenda-cordoba` conectado y la pregunta "¿qué hay gratis este finde en Córdoba?" usa `this_weekend` con `free_only`.

## 5. pyproject.toml (base)

```toml
[project]
name = "agenda-cba"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = ["httpx>=0.27", "pydantic>=2.7", "mcp>=1.2"]

[project.scripts]
agenda-cba = "agenda_cba.cli:main"
agenda-cba-mcp = "agenda_cba.mcp_server:main"

[dependency-groups]
dev = ["pytest>=8", "pytest-httpx>=0.30", "ruff>=0.6"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/agenda_cba"]

[tool.ruff]
line-length = 100
target-version = "py312"
```

## 6. Definición de terminado

- [ ] `uv run pytest` pasa en verde y `uv run ruff check` corre limpio.
- [ ] `uv run agenda-cba run` en local genera `data/raw/<hoy>.json`, `data/events.jsonl` (con unos 86 eventos a la fecha del plan), `data/changes.jsonl` y `data/status.json`.
- [ ] El validador detecta un cambio de sheet ID y un cambio de esquema (cubierto por tests).
- [ ] La Action corre por `workflow_dispatch`, commitea los datos y abre un issue cuando falla la validación.
- [ ] El MCP funciona en Claude Code mediante `.mcp.json`.
- [ ] Hay un README corto: qué es, de dónde salen los datos (con crédito a la Municipalidad de Córdoba), cómo correrlo y cómo conectar el MCP.

## 7. Siguientes pasos (no implementar ahora)

- Agregar más fuentes implementando `sources/base.py`: Agencia Córdoba Cultura, Alpogo y los PDFs municipales parseados con LLM.
- Deduplicar entre fuentes (lugar + fecha + similitud de título).
- Geocodificar lugares y agregar un tool `near(lat, lng, radius_km)`.
- Exponer el MCP vía HTTP para usarlo desde claude.ai.
