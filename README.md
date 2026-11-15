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

Los 6 tools están definidos una sola vez, en `packages/core/src/tools.ts`, y los consumen los dos
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

## Uso

```bash
pnpm install
pnpm build                # compila core, mcp, scraper y web
pnpm test                 # vitest (92 tests, con fixtures reales en tests/fixtures/)
pnpm lint                 # biome; pnpm format para arreglar

node apps/scraper/dist/index.js validate   # ¿sigue igual la fuente? exit 1 si hay FAIL
node apps/scraper/dist/index.js scrape     # baja la planilla y actualiza data/
node apps/scraper/dist/index.js run        # validate + scrape (no scrapea si hay FAIL)
```

En desarrollo, sin compilar: `pnpm --filter @cordoba/scraper run run` (usa `tsx`).

### Qué escribe el scraper

| Archivo               | Contenido                                                                        |
| --------------------- | -------------------------------------------------------------------------------- |
| `data/raw/<día>.json` | snapshot gviz desenvuelto del día (se sobrescribe si se corre dos veces)         |
| `data/events.jsonl`   | estado canónico, un evento por línea, ordenado por `id` (incluye `active=false`) |
| `data/changes.jsonl`  | log append-only: `added` / `updated` (con diff) / `removed` / `readded`          |
| `data/status.json`    | último run: validación, conteos, hash de esquema y del bundle                    |

Correr `scrape` dos veces con los mismos datos no genera cambios más allá de `last_seen`.

### Validador

`validate` corre, en orden: la página responde → el `<script>` del bundle sigue ahí → el sheet ID
sigue siendo el mismo → las 15 columnas no cambiaron. Niveles: **FAIL** (`bundle_missing`,
`sheet_id_changed`, `schema_changed`, `gviz_unreachable`), **WARN** (`page_blocked` por Wordfence,
`sheet_id_not_found`, `empty_sheet`) e **INFO** (`bundle_changed`: mismo ID, bundle distinto).
`run` no scrapea si hay FAIL, para no marcar todos los eventos como `removed` por un cambio de fuente.
Para probar ese camino: `AGENDA_SHEET_ID=<id-falso> node apps/scraper/dist/index.js run` → exit 1,
`data/events.jsonl` intacto y `status.json` con `scraped: false`.

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
| `source_status`   | —                                                                                        |

Más el resource `agenda://status`. Toda respuesta incluye `source`, `timezone` y `data_as_of`; en
los listados la `description` se trunca a 300 caracteres.

Smoke test de extremo a extremo (levanta el server y llama a cada tool):

```bash
pnpm --filter @cordoba/mcp run smoke
# o con el inspector:
npx @modelcontextprotocol/inspector node apps/mcp/dist/index.js
```

## Deploy en Cloudflare

Un único Worker (`cordoba-agenda`) sirve todo en **<https://cordobamcp.com>**, más la URL de
`*.workers.dev`, que queda activa porque la Action la usa para el smoke test inmediato (no espera
la propagación del dominio). El Custom Domain (`routes` en `wrangler.jsonc`) crea el registro DNS y
emite el certificado solo, pero la zona tiene que estar en la **misma cuenta de Cloudflare** que el
Worker.


| Ruta                | Qué devuelve                                                    |
| ------------------- | --------------------------------------------------------------- |
| `/`                 | la landing de Astro (assets estáticos, binding `ASSETS`)        |
| `/mcp`              | MCP por streamable HTTP (sólo POST; sin SSE ni Durable Objects) |
| `/health`           | conteos, `data_as_of` y resultado de la última validación       |
| `/api/events.jsonl` | los eventos crudos, para consumirlos sin MCP                    |
| `/api/status.json`  | el `status.json` del último run                                 |

Los eventos **viajan embebidos en el bundle**: `scripts/embed-data.mjs` convierte
`data/events.jsonl` en un módulo TypeScript antes de cada build (~60 KB gzip en total, el límite es
3 MB). No hay KV ni D1: cada commit del scraper dispara un deploy y así se actualizan los datos.

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

`.github/workflows/deploy.yml` corre lint + tests + build y publica el Worker con
`cloudflare/wrangler-action`, y después verifica `/health` y las 6 tools contra la URL desplegada.
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
