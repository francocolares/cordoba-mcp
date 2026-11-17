# cordoba-mcp — agenda de Córdoba (scraper + MCP)

Monorepo TypeScript (pnpm workspaces + Turborepo) que scrapea la **Agenda Turística de la
Municipalidad de Córdoba**, guarda los eventos con histórico en el repo y los expone a Claude
(o cualquier cliente MCP) por stdio.

```
apps/mcp       servidor MCP local por stdio
apps/scraper   CLI: validate | scrape | run
apps/web       landing con los próximos eventos (Astro, build estático)
apps/worker    Worker de Cloudflare: la landing + el MCP remoto en /mcp
packages/core  @cordoba/core: gviz, normalización, store, validador, queries, tools
data/          datos commiteados (git scraping): events.jsonl, changes.jsonl, status.json, raw/
```

Los 11 tools están definidos una sola vez, en `packages/core/src/tools.ts`, y los consumen los dos
transportes: stdio (`apps/mcp`) y HTTP (`apps/worker`).

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

`.mcp.json` ya está en la raíz; Claude Code lo levanta solo (requiere `pnpm build` previo):

```json
{
  "mcpServers": {
    "cordoba-mcp": {
      "command": "node",
      "args": ["apps/mcp/dist/index.js"],
      "env": { "AGENDA_DATA_PATH": "data/events.jsonl" }
    }
  }
}
```

Para usarlo desde otra máquina sin clonar el repo, en lugar de `AGENDA_DATA_PATH` usar
`AGENDA_DATA_URL=https://raw.githubusercontent.com/<user>/<repo>/main/data/events.jsonl`
(`status.json` se busca al lado). Los datos se cachean en memoria 10 minutos.

Tools:

| Tool              | Parámetros                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `search_events`   | `query?`, `category?`, `date_from?`, `date_to?`, `free_only?`, `include_past?`, `limit?` |
| `events_on`       | `date` (`hoy`, `mañana` o `aaaa-mm-dd`)                                                  |
| `this_weekend`    | `free_only?`, `category?` (viernes 18:00 → domingo 23:59)                                |
| `get_event`       | `id` (devuelve el evento completo, sin truncar)                                          |
| `list_categories` | —                                                                                        |
| `source_status`   | — (reporta las dos fuentes)                                                              |

Farmacias de turno:

| Tool                 | Parámetros                                                                   |
| -------------------- | ---------------------------------------------------------------------------- |
| `pharmacies_on_duty` | `date?` (`ahora` por default), `barrio?`, `near_lat?`, `near_lon?`, `limit?` |
| `pharmacies_near`    | `lat`, `lon`, `radius_km?` (3), `date?`, `limit?`                            |
| `duty_turno_on`      | `date?` → número de turno y conteo por sección, sin listar las 851           |
| `find_pharmacy`      | `query` (nombre, calle o barrio) → en qué turno está y sus próximas guardias |
| `get_pharmacy`       | `id`                                                                         |

Más el resource `agenda://status`. Toda respuesta incluye `source`, `source_url`, `timezone` y
`data_as_of` **de la fuente que la sirvió**; en los listados de la agenda la `description` se trunca
a 300 caracteres. Las respuestas de farmacias agregan `turno_window` y `disclaimer`, y marcan
`turno_derivado_del_ciclo: true` cuando la fecha cae fuera de los años con turnero cargado.

Smoke test de extremo a extremo (levanta el server y llama a cada tool):

```bash
pnpm --filter @cordoba/mcp run smoke
# o con el inspector:
npx @modelcontextprotocol/inspector node apps/mcp/dist/index.js
```

### Política de cambios en tools

`serverInfo.version` sale de una sola fuente: el campo `version` de
`packages/core/package.json`, exportado como `SERVER_VERSION` / `SERVER_INFO` desde
`@cordoba/core`. Lo reportan igual el servidor stdio y el Worker; para bumpear la versión se
toca ese `package.json` y nada más.

Reglas para tocar los tools:

- **Cambios compatibles** (parámetros nuevos _opcionales_, cambios de `description` o `title`,
  campos nuevos en la respuesta) se hacen **en el lugar**, sobre el tool existente, y se bumpea
  la versión minor.
- **Cambios incompatibles** (renombrar o sacar un parámetro, volver obligatorio uno que era
  opcional, cambiar el tipo o el significado de un campo) **no se hacen en el lugar**: se crea un
  tool nuevo con sufijo `_v2` (`search_events_v2`) y el anterior queda funcionando, marcado como
  deprecado **en su `description`** (`DEPRECADO: usar search_events_v2.`) durante **al menos una
  versión** antes de sacarlo.
- Los clientes ya conectados se enteran por `notifications/tools/list_changed`: ver abajo.

#### Avisar cambios en caliente (`listChanged`)

El servidor stdio declara `tools: { listChanged: true }` y `resources: { listChanged: true }` en
el `initialize`, y expone un punto único para cambiar el set de tools en runtime
(`apps/mcp/src/server.ts`):

```ts
const mcp = createCordobaMcpServer();

mcp.setToolEnabled("pharmacies_on_duty", false); // oculta el tool y notifica
mcp.refreshTools(); // notifica sin tocar el set
mcp.enabledToolNames(); // qué ve hoy un tools/list
```

`setToolEnabled` usa el mecanismo nativo del SDK (`RegisteredTool.enable()` / `.disable()`), que
ya emite la notificación por la sesión activa; `refreshTools()` es para cuando se modifica un tool
por fuera de enable/disable. El único consumidor real hoy es `syncToolsWithSnapshot()`, que sigue
el estado del dataset de farmacias (puede faltar o aparecer entre recargas del `SnapshotCache`) y
está **apagado por defecto** para no cambiar el comportamiento histórico: con
`CORDOBA_MCP_HIDE_UNAVAILABLE_TOOLS=1` los tools de farmacias desaparecen de `tools/list` cuando la
fuente no está cargada en vez de devolver un error.

#### El endpoint HTTP del Worker (`/mcp`) también notifica

`/mcp` tiene canal server→client: un `GET /mcp` con `Accept: text/event-stream`. Sigue **sin
estado compartido** (no hay registro de sesiones ni Durable Objects): el `Mcp-Session-Id` que se
emite en el `initialize` lleva adentro la **revisión de tools**, así que cada isolate puede decidir
por sí solo si el cliente que le llega está viendo una lista vieja.

- **La revisión** (`TOOLS_REVISION`, `apps/worker/src/mcp.ts`) es un hash de lo que devuelven
  `tools/list` y `resources/list`. Cambia al agregar, sacar o editar un tool (nombre, título,
  descripción o schema) y **no** cambia en los deploys que sólo traen datos nuevos, que son la
  mayoría: así los clientes no re-listan todos los días al vacío. Se publica en `/health` como
  `tools_revision`.
- **El aviso sale al (re)conectar el stream**, no en el instante del deploy. Es importante:
  un deploy de Cloudflare **no corta las conexiones abiertas**, el isolate viejo sigue atendiendo
  su stream. Lo que fuerza la reconexión es el **TTL** del stream (`MCP_SSE_TTL_S`, default 60s en
  `wrangler.jsonc`), que por eso es el mecanismo de entrega y no una optimización. Ese TTL es
  directamente **la latencia máxima**: con 60s, un cliente conectado se entera a más tardar 60s
  después del deploy. Más bajo = avisos más rápidos y más reconexiones.

Hay tres detalles en `apps/worker/src/sse.ts` que salieron de medirlo contra Cloudflare y que
conviene no "simplificar" sin volver a probar en producción:

1. **Ni un `await` al writer antes de devolver la `Response`.** Escribir bloquea por backpressure
   mientras nadie lee el readable, y workerd mata el request con _"your Worker's code had hung and
   would never generate a response"_. En `node:http` no falla: se cuelga callado.
2. **El keepalive lleva `id:` y `data:` no vacía** (`event: keepalive`). Un bloque con sólo `id:`,
   o un comentario `: ...`, **no despacha evento** —la spec SSE no despacha con el data buffer
   vacío—, así que el cliente no refrescaría su resumption token.
3. **Se mira el `Last-Event-ID`, no sólo el session id.** El cliente nunca rota su
   `Mcp-Session-Id` (el SDK sólo lo lee de la respuesta del POST), así que con el session id solo
   se re-notifica en cada reconexión, para siempre.

El TTL además acota los streams huérfanos: `request.signal` **no dispara** cuando el cliente se va
(medido en producción) y escribir a un socket muerto no falla, así que sin TTL el loop de keepalive
queda girando para siempre.

Lo que este diseño **no** da: notificar en medio de una sesión por algo que no sea un cambio de
revisión (un feature flag, una fuente que se cae). Para eso haría falta un broadcast entre
isolates, y eso sí pide Durable Objects: los streams de distintos clientes caen en isolates
distintos y no se ven entre ellos.

## Deploy en Cloudflare

Un único Worker (`cordoba-agenda`) sirve todo en **<https://cordobamcp.com>**, más la URL de
`*.workers.dev`, que queda activa porque la Action la usa para el smoke test inmediato (no espera
la propagación del dominio). El Custom Domain (`routes` en `wrangler.jsonc`) crea el registro DNS y
emite el certificado solo, pero la zona tiene que estar en la **misma cuenta de Cloudflare** que el
Worker.


| Ruta                         | Qué devuelve                                                    |
| ---------------------------- | --------------------------------------------------------------- |
| `/`                          | la landing de Astro (assets estáticos, binding `ASSETS`)        |
| `/mcp`                       | MCP por streamable HTTP (sólo POST; sin SSE ni Durable Objects) |
| `/health`                    | conteos, `data_as_of` y resultado de la última validación       |
| `/api/events.jsonl`          | los eventos crudos, para consumirlos sin MCP                    |
| `/api/status.json`           | el `status.json` del último run                                 |
| `/api/farmacias.jsonl`       | las farmacias crudas, con turno, sección y coordenadas          |
| `/api/farmacias/turnos.json` | los calendarios `fecha -> turno` por año                        |
| `/api/farmacias/status.json` | el `status.json` de la última ingesta del turnero               |

Los datos **viajan embebidos en el bundle**: `scripts/embed-data.mjs` convierte `data/events.jsonl`
y `data/farmacias/` en un módulo TypeScript antes de cada build (el límite del Worker es 3 MB
comprimido y las 851 farmacias suman ~400 KB sin comprimir). No hay KV ni D1: cada commit de datos
dispara un deploy y así se actualizan. Si falta el dataset de farmacias, el Worker arranca igual y
los tools de guardias responden un error explícito.

```bash
pnpm dev:worker    # wrangler dev en :8787 (o --port) con los assets de Astro
pnpm deploy        # embed-data + wrangler deploy
pnpm --filter @cordoba/worker run smoke [url]   # cliente MCP real contra el deploy
```

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

`.github/workflows/deploy.yml` corre lint + tests + build y publica el Worker con
`cloudflare/wrangler-action`, y después verifica `/health` y las tools contra la URL desplegada.
Se dispara con un push a `main`, a mano, o llamado por el scraper cuando dejó datos nuevos (los
push hechos con `GITHUB_TOKEN` no disparan workflows, así que el scrape invoca el deploy como
workflow reutilizable).

Las credenciales viven en el **environment `prod`** del repo
(Settings → Environments → `prod` → _Environment secrets_), no como secrets del repositorio: el
job `deploy` declara `environment: prod` y es el único que las ve.

| Secret                  | Para qué                                                                         |
| ----------------------- | -------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | token con permiso **Workers Scripts: Edit** (y Workers KV si lo agregás después) |
| `CLOUDFLARE_ACCOUNT_ID` | el account id de tu cuenta de Cloudflare                                         |

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
- El MCP remoto es **stateless**: responde cada POST con un JSON (la spec de streamable HTTP lo
  permite) en lugar de abrir un stream SSE. Alcanza para tools de sólo lectura y evita depender de
  Durable Objects. Si algún día hace falta notificar cambios al cliente, ahí sí hay que migrar a
  `agents`/`McpAgent` con DO.
- Para sumar fuentes (Agencia Córdoba Cultura, Alpogo, PDFs municipales) se implementa la interfaz
  `Source` de `packages/core/src/sources/base.ts`. Falta todavía: deduplicación entre fuentes,
  geocodificación y MCP por HTTP.

Requiere Node >= 22 y pnpm 11 (`corepack enable`).
