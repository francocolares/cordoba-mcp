# cordoba-mcp — los datos públicos de Córdoba, para tu asistente

**Una fuente de datos unificada y estandarizada para potenciar la riqueza de los datos públicos de
Córdoba con la vanguardia en inteligencia artificial.**

Monorepo TypeScript (pnpm workspaces + Turborepo) que scrapea fuentes públicas de Córdoba, las
normaliza a un modelo común, guarda los datos con histórico en el repo y los expone por MCP en
**<https://cordobamcp.com/mcp>** a Claude, ChatGPT o cualquier cliente que hable streamable HTTP.

```
apps/scraper   CLI: validate | scrape | run
apps/web       landing (Astro, build estático)
apps/worker    Worker de Cloudflare: la landing + el MCP remoto en /mcp
packages/core  @cordoba/core: catálogo de colecciones, normalización, store, validador, queries, tools
data/          datos commiteados (git scraping): events.jsonl, changes.jsonl, status.json, raw/
```

Sólo hay camino remoto: no se instala nada, no hay servidor stdio. La superficie son **cuatro
tools** (`list_collections`, `search`, `get`, `source_status`), definidas una sola vez en
`packages/core/src/tools.ts`, y está **congelada**: sumar una fuente o una colección es registrar
un descriptor en `packages/core/src/collections/`, no agregar una tool. Por eso un cliente que ya
tiene `tools/list` cacheado no necesita reconectar para ver datos nuevos.

## Puesta en marcha

```bash
pnpm bootstrap            # entorno -> install -> build -> primer scrape -> deploy -> secrets
pnpm bootstrap --dry-run  # muestra qué haría, sin publicar nada
```

El bootstrap es idempotente y pide confirmación antes de cada paso que sale de tu máquina
(publicar el Worker, escribir secrets en GitHub). Flags: `--yes`, `--skip-deploy`, `--skip-github`.
Si `wrangler` no está autenticado te dice que corras
`pnpm --filter @cordoba/worker exec wrangler login`; si no tenés `gh`, te deja las instrucciones
manuales para los secrets.

## De dónde salen los datos

La página <https://turismo.cordoba.gob.ar/agenda-turistica/> es una app Angular embebida en
WordPress que lee **una única Google Sheet pública** por el endpoint `gviz`. El sheet ID está en el
HTML, en el atributo `sheetid` de `<app-root>` (el bundle `main.js` arma la URL en runtime, así que
el ID **no** aparece literal ahí). `robots.txt` no restringe nada.

Crédito de los datos: **Municipalidad de Córdoba**. Este repo sólo los normaliza y republica.

Detalles de la fuente que conviene recordar:

- La respuesta gviz viene envuelta en `/*O_o*/ google.visualization.Query.setResponse({...});`.
- Cada celda es `{v, f}` o `null`: se usa `f` (formateado) y si no `v`. Las fechas pueden venir como
  `Date(2026,10,29)` (**mes base 0**) o `29/11/2026`.
- `?evento=N` es el índice de fila, **no** un ID estable. Nosotros calculamos
  `sha1(nombre + fecha + lugar)[:12]` y guardamos el índice sólo como `source_row`.
- `Tipo de Evento` es texto libre (~25 variantes); se mapea por keywords a un set canónico chico.
- `Precio` sólo distingue `0` (gratis), `Con costo` y `Comprá tu entrada en “Inscribite”`.
- Zona horaria: `America/Argentina/Cordoba`, UTC-3 fijo (sin horario de verano).

### Farmacias de turno (Colegio de Farmacéuticos)

El cronograma anual de **guardias obligatorias** no es una API: es un `.xls` que circula por Drive.
El endpoint `export?format=xlsx` responde anónimo, pero el zip **no es reproducible** (cambia en
cada descarga), así que el detector de cambios compara el hash del _contenido normalizado_, no del
binario. El archivo se commitea en `data/raw/farmacias/turnero-<año>.xlsx` y es la fuente de verdad
del año: los builds no dependen del link.

Crédito de los datos: **Colegio de Farmacéuticos de la Provincia de Córdoba**.

Forma de la planilla (verificada contra el turnero 2026):

- Hoja `TURNERO <año>`: col A = día del mes, y una columna por mes (`enero`..`diciembre`) cuya celda
  es el **número de turno (1..30)**. Hay una columna que repite el día, así que los meses se mapean
  por su encabezado y **no** por posición.
- Hojas `1`..`30`: col A = **sección** (viene sólo en la primera fila de cada sección: hay que
  arrastrarla) y col B = `NOMBRE - dirección Bº barrio`. En 2026 hay 851 farmacias en 16 secciones
  (la 15 no existe), entre 24 y 34 por turno.
- **Cada farmacia pertenece a un solo turno**: el turno es un atributo de la farmacia, no una fila
  de calendario. El `id` sale de `sha1(celda normalizada)[:12]` porque los nombres se repiten (hay
  dos `LOS ANDES`, dos `ALVEAR`).
- La rotación es un **ciclo de 30 días** exacto: los 365 días de 2026 cumplen
  `turno = (turno_anterior mod 30) + 1`, con ancla `2026-01-02 → turno 1`. El validador lo verifica;
  si algún año se desvía, es un cambio deliberado del Colegio (o un typo) y queremos verlo.
- El corte nombre/dirección es heurístico: el primer guion con espacio a algún lado, salteando el
  que antecede al barrio (`MADUSSI-Libertad 2033 - B° General Paz`). Las 20 filas sin guion se
  adivinan por el prefijo en mayúsculas y quedan marcadas con `parse_confidence: "baja"`. El crudo
  se conserva siempre en `raw`.
- Las coordenadas salen de geocodificar la dirección **una sola vez**, con la cache commiteada en
  `data/farmacias/geocode.json` (el artefacto caro del dataset). Son dos pasadas:
  1. **Georef** (`apis.datos.gob.ar`), el servicio oficial de direcciones normalizadas de
     Argentina: acepta **lotes** (un POST resuelve 100 direcciones), no tiene rate limit y entiende
     la nomenclatura local —`Rep. De Siria` → `RCA DE SIRIA`, `Bv.Ocampo` → `BV GRL OCAMPO`—, que es
     justo donde Nominatim falla con esta planilla. Resolvió **606 de 728 en 9 requests y segundos**.
  2. **Nominatim** (OSM) para el resto, a 1 request por segundo, porque es el único que tiene el
     fallback por barrio. Nominatim **devuelve 503 en tandas largas aunque respetes el límite**: el
     geocoder reintenta con espera creciente, guarda la cache cada 25 direcciones y se puede cortar
     y retomar. Por eso Georef va primero: sin él, una corrida completa son horas y en CI no cierra.

  Las abreviaturas de la planilla se expanden antes de consultar (`Av.`, `Bv.`, `Gral.`, `Cnel.`,
  `Dnto` → `Donato`...) y cada resultado se valida contra la caja de la ciudad: un match en Buenos
  Aires se descarta. La precisión queda registrada por farmacia (`exacta` con altura, `calle`,
  `barrio`, `ninguna`) y viaja en las respuestas del MCP.

> **Lo único que falta confirmar:** la planilla **no dice de qué hora a qué hora corre la guardia**
> (no hay leyenda ni nota en ninguna de las 31 hojas). La ventana se asume de 08:30 a 08:30 del día
> siguiente, viaja declarada en cada respuesta con `confirmed: false` y se configura con
> `FARMACIAS_TURNO_START` / `FARMACIAS_TURNO_HORAS` / `FARMACIAS_TURNO_CONFIRMADO`. El código ya
> maneja el cruce de medianoche: a las 02:00 del martes sigue de turno la farmacia del lunes.

## Uso

```bash
pnpm install
pnpm build                # compila core, mcp, scraper y web
pnpm test                 # vitest (165 tests, con fixtures reales en tests/fixtures/)
pnpm lint                 # biome; pnpm format para arreglar

node apps/scraper/dist/index.js validate   # ¿sigue igual la fuente? exit 1 si hay FAIL
node apps/scraper/dist/index.js scrape     # baja la planilla y actualiza data/
node apps/scraper/dist/index.js run        # validate + scrape (no scrapea si hay FAIL)

# farmacias de turno (una vez al año, no en el cron diario)
node apps/scraper/dist/index.js farmacias validate   # parsea y valida, sin escribir nada
node apps/scraper/dist/index.js farmacias ingest     # persiste data/farmacias/
node apps/scraper/dist/index.js farmacias geocode    # geocodifica lo que falte y actualiza la cache
```

Opciones de `farmacias`: `--file <path>` (default: el `.xlsx` commiteado), `--download` (bajarlo de
Drive), `--url <url>`, `--year <aaaa>`; y para el geocoder `--limit <n>`, `--retry-failed`,
`--skip-georef` y `--skip-nominatim` (útil para quedarse sólo con la pasada rápida).

En desarrollo, sin compilar: `pnpm --filter @cordoba/scraper run run` (usa `tsx`).

### Qué escribe el scraper

| Archivo               | Contenido                                                                        |
| --------------------- | -------------------------------------------------------------------------------- |
| `data/raw/<día>.json` | snapshot gviz desenvuelto del día (se sobrescribe si se corre dos veces)         |
| `data/events.jsonl`   | estado canónico, un evento por línea, ordenado por `id` (incluye `active=false`) |
| `data/changes.jsonl`  | log append-only: `added` / `updated` (con diff) / `removed` / `readded`          |
| `data/status.json`    | último run: validación, conteos, hash de esquema y del bundle                    |

Correr `scrape` dos veces con los mismos datos no genera cambios más allá de `last_seen`.

### Qué escribe la ingesta de farmacias

| Archivo                                 | Contenido                                                                   |
| --------------------------------------- | --------------------------------------------------------------------------- |
| `data/raw/farmacias/turnero-<año>.xlsx` | la planilla original: fuente de verdad del año                              |
| `data/farmacias/pharmacies.jsonl`       | una farmacia por línea, ordenada por `id`, con turno, sección y coordenadas |
| `data/farmacias/turnos.json`            | un calendario por año: `fecha -> turno`, más el ancla del ciclo             |
| `data/farmacias/geocode.json`           | cache de geocoding por dirección normalizada (el artefacto caro)            |
| `data/farmacias/changes.jsonl`          | log append-only: altas, bajas y **cambios de turno** con diff               |
| `data/farmacias/status.json`            | último run: validación, conteos, años cargados y hash de contenido          |

Las coordenadas **no entran al `content_hash`**: volver a geocodificar no genera un `updated`
espurio en `changes.jsonl`.

### Validador

`validate` corre, en orden: la página responde → el `<script>` del bundle sigue ahí → el sheet ID
sigue siendo el mismo → las 15 columnas no cambiaron. Niveles: **FAIL** (`bundle_missing`,
`sheet_id_changed`, `schema_changed`, `gviz_unreachable`), **WARN** (`page_blocked` por Wordfence,
`sheet_id_not_found`, `empty_sheet`) e **INFO** (`bundle_changed`: mismo ID, bundle distinto).
`run` no scrapea si hay FAIL, para no marcar todos los eventos como `removed` por un cambio de fuente.
Para probar ese camino: `AGENDA_SHEET_ID=<id-falso> node apps/scraper/dist/index.js run` → exit 1,
`data/events.jsonl` intacto y `status.json` con `scraped: false`.

### Validador del turnero

`farmacias validate` chequea: están las 30 hojas de turno → el calendario cubre el año completo →
la rotación respeta el ciclo de 30 días → cada turno tiene una cantidad razonable de farmacias →
las secciones están en rango → no hay filas duplicadas. Niveles: **FAIL** (`turnos_faltantes`,
`calendario_incompleto`, `turnos_vacios`), **WARN** (`ciclo_roto`, `turnos_flacos`,
`anio_inesperado`, `secciones_fuera_de_rango`, `filas_duplicadas`) e **INFO** (`parseo`: cuántas
filas se adivinaron). Con FAIL **no se persiste nada**, para no dar de baja 851 farmacias por un
archivo mal exportado.

## MCP

Se conecta por URL, sin instalar nada. `.mcp.json` ya está en la raíz y Claude Code lo levanta solo:

```json
{
  "mcpServers": {
    "cordoba-mcp": { "type": "http", "url": "https://cordobamcp.com/mcp" }
  }
}
```

Para apuntar al Worker local: `pnpm dev:worker` y la URL `http://127.0.0.1:8799/mcp`.

### Las cuatro tools

| Tool               | Parámetros                                                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_collections` | `collection?`, `include?` (`sources`, `examples`, `taxonomies`)                                                                                                |
| `search`           | `collection`, `query?`, `date?{from,to,include_past}`, `near?{lat,lon,radius_km}`, `filters?`, `source?`, `group_by?`, `sort?`, `fields?`, `limit?`, `cursor?` |
| `get`              | `ids[]` (con prefijo), `expand?`                                                                                                                               |
| `source_status`    | `collection?`                                                                                                                                                  |

Más el resource `cordoba://catalog`, de URI fija: lo que crece es su contenido, no la lista de
resources.

**El eje es la colección, no la fuente.** Una colección es un tipo de registro (`eventos`,
`farmacias_turno`) y puede alimentarse de varias fuentes; `source` es un filtro opcional. Así
sumar un organismo nuevo a `eventos` no cambia nada de lo que el cliente ve.

Colecciones de hoy:

| Colección         | Fuente                                                       | Filtros declarados                          |
| ----------------- | ------------------------------------------------------------ | ------------------------------------------- |
| `eventos`         | Agenda Turística – Municipalidad de Córdoba                  | `category`, `free_only`, `include_inactive` |
| `farmacias_turno` | Cronograma de Guardias – Colegio de Farmacéuticos de Córdoba | `on_duty`, `barrio`, `turno`, `seccion`     |

### Convenciones de la API

- **Fechas:** instantes en ISO 8601 con offset de Córdoba (`2026-11-18T20:00:00-03:00`), fechas
  sin hora en `aaaa-mm-dd`. La entrada acepta los tokens relativos que declara cada colección
  (`hoy`, `mañana`, `ahora`, `fin_de_semana`) y la respuesta siempre devuelve `resolved` con lo
  que se interpretó.
- **Coordenadas:** `lat`/`lon` (nunca `lng`), `radius_km` de entrada, `distance_km` de salida.
  Las colecciones sin coordenadas responden `unsupported` en vez de ignorar el `near`.
- **Paginación:** `limit` (default 20, máx 100) y `cursor` opaco. La respuesta trae `count`,
  `total`, `truncated` y `next_cursor`.
- **Ids:** `<collection>:<source>:<id_local>`, que es lo que `get` espera. El prefijo se arma al
  serializar: en los `.jsonl` el id sigue siendo el local, así que esto no obliga a re-ingestar.
  `get` acepta un id pelado mientras no sea ambiguo.
- **Errores:** una sola forma, con `isError: true`:
  `{ "error": { "code", "message", "hint", "valid_values" } }`. Códigos: `unknown_collection`,
  `unknown_filter`, `invalid_filter_value`, `invalid_date`, `invalid_cursor`, `invalid_id`,
  `source_unavailable`, `not_found`, `unsupported`. `valid_values` convierte el error en
  discovery: el modelo se corrige sin tener que llamar a `list_collections`.
- **Envelope:** igual en todas las respuestas, con `service`, `collection`, `sources[]` (nombre,
  url, licencia y `data_as_of` de cada una), `timezone`, `catalog_version` y `notes`. Los
  supuestos del dominio (p. ej. que el horario de la guardia no figura en la planilla del
  Colegio) viajan como `notes` de la colección.

Smoke test de extremo a extremo (recorre toda la superficie contra un server corriendo):

```bash
pnpm --filter @cordoba/worker run smoke            # contra wrangler dev
node apps/worker/smoke.mjs https://cordobamcp.com/mcp
# o con el inspector:
npx @modelcontextprotocol/inspector
```

### Política de cambios en tools

`serverInfo.version` sale de una sola fuente: el campo `version` de
`packages/core/package.json`, exportado como `SERVER_VERSION` / `SERVER_INFO` desde
`@cordoba/core`. Para bumpear la versión se toca ese `package.json` y nada más.

**La regla es que la superficie no cambia.** Lo que obliga a un cliente a reconectar no es un
deploy —con streamable HTTP sin estado, el isolate nuevo atiende el próximo POST y el cliente no
nota nada—, sino que cambie lo que se entrega en el handshake. Son tres cosas, y las tres están
congeladas a propósito:

1. **`tools/list`:** cuatro tools. Una colección nueva no la toca.
2. **`instructions` del `initialize`:** queda pegada a la sesión, así que **no nombra fuentes ni
   colecciones concretas** (`SERVER_INSTRUCTIONS`, `packages/core/src/branding.ts`). Si las
   nombrara, cada fuente nueva dejaría mintiendo a los clientes ya conectados.
3. **`resources/list`:** un resource de URI fija (`cordoba://catalog`) cuyo contenido crece.

Consecuencias prácticas:

- Agregar datos (colección nueva, fuente nueva dentro de una colección, filtro nuevo declarado en
  un descriptor) es **siempre compatible** y no necesita aviso: el modelo lo descubre con
  `list_collections`, y `catalog_version` viaja en cada respuesta para que note que cambió.
- Un cambio incompatible en una de las cuatro tools se trata como lo que es: un evento raro, que
  se hace en una versión mayor y se anuncia en el README y en la landing.
- **No hay canal server→client.** Antes había un `GET /mcp` con SSE cuyo único trabajo era emitir
  `notifications/tools/list_changed`, con TTL, keepalive, `Last-Event-ID` y la revisión de tools
  metida dentro del `Mcp-Session-Id`. Con la superficie congelada esa notificación no se dispara
  nunca, así que se borró junto con `apps/worker/src/sse.ts` y el servidor no declara
  `listChanged`: el `GET /mcp` devuelve `405` (la spec lo contempla y el SDK lo trata como caso
  esperado). Si algún día hay que volver a notificar un cambio de superficie, el mecanismo está en
  el historial de git, no mantenido "por si acaso".

### Rutas HTTP de datos

Se generan iterando el catálogo, así que una colección nueva aparece sola:

| Ruta                               | Qué devuelve                            |
| ---------------------------------- | --------------------------------------- |
| `/api/{collection}.jsonl`          | los registros crudos, NDJSON            |
| `/api/{collection}/status.json`    | el estado de esa colección              |
| `/api/farmacias_turno/turnos.json` | el turnero (extra de esa colección)     |
| `/health`                          | una fila por colección, con sus conteos |

Las rutas anteriores (`/api/events.jsonl`, `/api/status.json`, `/api/farmacias.jsonl`,
`/api/farmacias/status.json`, `/api/farmacias/turnos.json`) se mantienen como alias.

## Deploy en Cloudflare

Un único Worker (`cordoba-agenda`) sirve todo en **<https://cordobamcp.com>**, más la URL de
`*.workers.dev`, que queda activa porque la Action la usa para el smoke test inmediato (no espera
la propagación del dominio). El Custom Domain (`routes` en `wrangler.jsonc`) crea el registro DNS y
emite el certificado solo, pero la zona tiene que estar en la **misma cuenta de Cloudflare** que el
Worker.


| Ruta                               | Qué devuelve                                                    |
| ---------------------------------- | --------------------------------------------------------------- |
| `/`                                | la landing de Astro (assets estáticos, binding `ASSETS`)        |
| `/mcp`                             | MCP por streamable HTTP (sólo POST; sin SSE ni Durable Objects) |
| `/health`                          | una fila por colección: conteos, `data_as_of` y validación      |
| `/api/{collection}.jsonl`          | los registros crudos de una colección, para consumirlos sin MCP |
| `/api/{collection}/status.json`    | el `status.json` del último run de esa colección                |
| `/api/farmacias_turno/turnos.json` | los calendarios `fecha -> turno` por año                        |

Las rutas anteriores siguen respondiendo como alias (ver "Rutas HTTP de datos").

### Los datos viven en R2

El Worker **no lleva los datos adentro**: los lee del bucket de R2 que declara `wrangler.jsonc`
(binding `DATA`). Antes viajaban embebidos en el bundle, lo que ataba cada dato nuevo a un deploy
del código y hacía crecer el bundle con cada colección (616 KB con dos).

El layout del bucket lo escribe `apps/worker/scripts/sync-r2.mjs`:

```
manifest.json                      lo único mutable: por colección, qué objeto es
                                   cada archivo y el hash de su contenido
eventos/records.jsonl              los registros
eventos/status.json                el status del último run
farmacias_turno/records.jsonl
farmacias_turno/status.json
farmacias_turno/turnos.json
```

Las claves son **estables** (se sobrescriben, no se acumulan versiones) y el hash del manifest es
la versión de caché: el Worker cachea cada objeto en la caché del edge con la clave
`<key>?v=<hash>`, así que una entrada no se invalida, caduca. El manifest se cachea 60 s por
isolate — esa es la latencia máxima con la que un dato nuevo llega al MCP — y se sube **último**,
cuando los objetos que referencia ya están arriba.

Quién sube: el workflow que scrapea (`scrape-agenda`, `farmacias-turnero`), no el de deploy. Por
eso `deploy-cloudflare` ya **no** se dispara por cambios en `data/`: el deploy es sólo para código.

Sin respaldo embebido a propósito. Si R2 no responde, las colecciones quedan en `null`, `search` y
`get` contestan `source_unavailable`, `/api/*` devuelve 503 y `/health` publica el error en
`data_source.error`. Si había un snapshot bueno en el isolate, se sigue sirviendo hasta el próximo
intento: es preferible un dato de hace un rato a ninguno.

```bash
pnpm dev:worker                                 # siembra el R2 local y levanta wrangler dev
pnpm --filter @cordoba/worker run sync-r2       # sube data/ a R2 (necesita credenciales)
pnpm --filter @cordoba/worker run sync-r2 --dry-run
pnpm --filter @cordoba/worker run seed-r2       # el R2 simulado de wrangler dev
pnpm deploy                                     # wrangler deploy (ya no embebe nada)
pnpm --filter @cordoba/worker run smoke [url]   # cliente MCP real contra el deploy
```

**El bucket lo crea la Action**: `sync-r2.mjs --ensure-bucket` lo crea si no existe y no hace nada
si ya está, y lo corren tanto `sync-data.yml` como el deploy (el Worker declara el binding, así que
el bucket tiene que existir antes de publicar). Para la primera carga sin esperar el cron: Actions →
**sync-data** → _Run workflow_. También lo hace `pnpm bootstrap` (paso 7), o a mano con
`pnpm --filter @cordoba/worker exec wrangler r2 bucket create cordoba-mcp-data`.

Requisitos de permisos: el token del environment `prod` necesita `Workers R2 Storage: Edit` (crear
el bucket y subir objetos van por la API de Cloudflare con ese mismo token). Y la cuenta tiene que
tener **R2 activado** una vez desde el dashboard: eso no lo arregla ningún permiso, y el script
distingue los dos errores en su salida.

### Elegir en qué cuenta de Cloudflare se despliega

`wrangler whoami` muestra con qué login estás y **qué cuentas ve ese login**. El nombre de la
cuenta no tiene nada que ver con el mail: un login puede ser miembro de varias cuentas (propias o
de una organización), y el deploy va a la que se resuelva en este orden:

1. `--account <id>` en `pnpm bootstrap`
2. la variable `CLOUDFLARE_ACCOUNT_ID`
3. si el login ve una sola cuenta, esa
4. si ve varias, el bootstrap te hace elegir (nunca decide solo)

El prompt de confirmación nombra la cuenta y el id antes de publicar, así que no se puede publicar
en la cuenta equivocada sin verlo.

```bash
pnpm bootstrap --account <account-id>            # fija la cuenta destino
CLOUDFLARE_ACCOUNT_ID=<id> pnpm deploy           # idem para un deploy suelto
```

Para desplegar con **otro login** de Cloudflare hay dos caminos:

```bash
# a) OAuth: cambia la credencial global de wrangler (~/.config/.wrangler)
pnpm --filter @cordoba/worker exec wrangler logout
pnpm --filter @cordoba/worker exec wrangler login   # abre el browser

# b) API token: no toca nada global, sirve igual en local y en CI
#    Dashboard de la cuenta destino -> My Profile -> API Tokens -> Create Token
#    -> Edit Cloudflare Workers (o permiso Workers Scripts: Edit)
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
pnpm deploy
```

El token tiene prioridad sobre el OAuth guardado, así que (b) es la opción recomendada cuando
manejás más de una cuenta: cada shell despliega donde le corresponde y es exactamente lo mismo que
usa la Action (`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` como secrets del repo).

Si la cuenta destino todavía no existe, se crea desde el dashboard de Cloudflare
(**Account Home → Add account**) o registrándose con otro mail; recién después aparece en
`wrangler whoami`.

Para conectarlo como MCP remoto:

```bash
claude mcp add --transport http cordoba-mcp https://cordobamcp.com/mcp
```

## Automatización

`.github/workflows/scrape.yml` corre todos los días a las 06:17 de Córdoba: tests → build →
`validate` → `scrape` → commit de `data/`. Si la validación falla, abre **un solo** issue con la
label `scraper-alert` y no commitea. El primer run se hace a mano con `workflow_dispatch`.

`.github/workflows/farmacias.yml` tiene dos caras, porque el turnero es un archivo anual y no un
feed: el cron del **día 5 de cada mes** sólo baja la planilla y compara el hash de contenido, y abre
un issue (label `farmacias-alert`) si cambió **o si desde octubre no está el turnero del año
siguiente** — sin ese aviso el dataset se degrada en silencio el 1 de enero. La ingesta de verdad se
dispara a mano (`workflow_dispatch` con `ingest: true`): valida, geocodifica lo nuevo, commitea
`data/farmacias/` y llama al deploy. El paso de geocoding es `continue-on-error`: si Nominatim nos
limita a mitad de camino, lo resuelto se commitea igual y el próximo run retoma.

`.github/workflows/sync-data.yml` sube `data/` a R2, que es **lo que publica un dato nuevo**: el
Worker lo lee de ahí, así que no hace falta desplegar nada. Lo llaman los dos workflows de scrape
cuando commitearon datos (los push con `GITHUB_TOKEN` no disparan workflows, así que lo invocan como
workflow reutilizable) y también se corre a mano desde Actions → _Run workflow_, que es la forma de
hacer la primera carga. Después verifica contra `/health` que las colecciones estén disponibles,
reintentando 2 minutos: el manifest se cachea 60 s por isolate.

`.github/workflows/deploy.yml` corre lint + tests + build, asegura el bucket de R2, publica el
Worker con `cloudflare/wrangler-action` y verifica `/health` y las tools contra la URL desplegada.
Se dispara con un push a `main` o a mano. **No** se dispara por cambios en `data/`: el deploy es
sólo para código.

Las credenciales viven en el **environment `prod`** del repo
(Settings → Environments → `prod` → _Environment secrets_), no como secrets del repositorio: el
job `deploy` declara `environment: prod` y es el único que las ve.

| Secret                  | Para qué                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | permisos **Workers Scripts: Edit** (deploy) y **Workers R2 Storage: Edit** (datos) |
| `CLOUDFLARE_ACCOUNT_ID` | el account id de tu cuenta de Cloudflare                                           |

Sin `Workers R2 Storage: Edit` el deploy falla al asegurar el bucket y el scrape diario falla al
publicar: el server queda en pie, pero sirviendo los datos que ya estaban en R2.

Con dominio propio el token necesita además, **acotado a la zona `cordobamcp.com`**:
`Zone → Workers Routes: Edit` y `Zone → Zone: Read`. La plantilla _Edit Cloudflare Workers_ ya los
trae; un custom token mínimo, no, y el deploy falla al crear la ruta.

El smoke test posterior al deploy usa el `deployment-url` que informa `wrangler-action`, que con un
Custom Domain viene como `cordobamcp.com (custom domain)` —sin esquema y con el sufijo literal—, así
que el workflow lo normaliza y reintenta 3 minutos (un certificado recién emitido tarda en
responder). Si querés forzar otra URL, definí la **variable** (no secret) `PROD_URL`:

```
PROD_URL = https://cordobamcp.com
```

Si además le ponés _required reviewers_ al environment, cada deploy queda esperando aprobación
manual — incluido el que dispara el scraper cuando baja datos nuevos.

## Notas

- Los entrypoints fuerzan `ipv4first` en el resolver DNS: en WSL2 y en runners sin IPv6 real,
  `fetch` a `documentos.cordoba.gob.ar` queda colgado esperando AAAA.
- El MCP es **stateless**: responde cada POST con un JSON (la spec de streamable HTTP lo permite)
  en lugar de abrir un stream SSE, y no hay registro de sesiones ni Durable Objects. Con la
  superficie de tools congelada no hay nada que notificar, así que tampoco hace falta.
- Para sumar una fuente se implementa la interfaz `Source` de
  `packages/core/src/sources/base.ts` y se registra un descriptor de colección en
  `packages/core/src/collections/` (ver `docs/tools-design.md`). Falta todavía: deduplicación
  entre fuentes y geocodificación de venues.

Requiere Node >= 22 y pnpm 11 (`corepack enable`).
