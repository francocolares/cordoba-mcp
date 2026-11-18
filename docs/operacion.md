# Operación: correr, actualizar y desplegar

Monorepo TypeScript (pnpm workspaces + Turborepo). Requiere Node >= 22 y pnpm 11
(`corepack enable`).

```
apps/scraper   CLI: validate | scrape | run | farmacias …
apps/web       landing (Astro, build estático)
apps/worker    Worker de Cloudflare: la landing + el MCP remoto en /mcp
packages/core  @cordoba/core: catálogo de colecciones, normalización, store, validadores,
               queries y tools
data/          datasets normalizados, con histórico
```

```bash
pnpm install
pnpm build                # core, worker, scraper y web
pnpm test                 # vitest, con fixtures reales en tests/fixtures/
pnpm lint                 # biome; pnpm format para arreglar
pnpm dev:worker           # siembra el R2 local y levanta wrangler dev en :8799
```

Para apuntar un cliente MCP al Worker local: `http://127.0.0.1:8799/mcp`.

## Puesta en marcha de una instancia propia

```bash
pnpm bootstrap            # entorno -> install -> build -> primer scrape -> deploy -> secrets
pnpm bootstrap --dry-run  # muestra qué haría, sin publicar nada
```

Es idempotente y pide confirmación antes de cada paso que sale de tu máquina (publicar el Worker,
escribir secrets en GitHub). Flags: `--yes`, `--skip-deploy`, `--skip-github`, `--account <id>`.

## Las fuentes

### Agenda de eventos — Municipalidad de Córdoba

La página pública es una app Angular embebida en WordPress que lee **una única Google Sheet pública**
por el endpoint `gviz`; el sheet ID está en el HTML, en el atributo `sheetid` de `<app-root>`.

Lo que conviene recordar al tocar el parser:

- La respuesta gviz viene envuelta en `/*O_o*/ google.visualization.Query.setResponse({...});`.
- Cada celda es `{v, f}` o `null`: se usa `f` (formateado) y si no `v`. Las fechas pueden venir como
  `Date(2026,10,29)` (**mes base 0**) o `29/11/2026`.
- `?evento=N` es el índice de fila, **no** un id estable: el id es `sha1(nombre + fecha + lugar)[:12]`
  y el índice se guarda sólo como `source_row`.
- `Tipo de Evento` es texto libre (~25 variantes); se mapea por keywords a un set canónico chico.
- `Precio` sólo distingue gratis, con costo y "comprá tu entrada".

```bash
node apps/scraper/dist/index.js validate   # ¿sigue igual la fuente? exit 1 si hay FAIL
node apps/scraper/dist/index.js scrape     # actualiza data/
node apps/scraper/dist/index.js run        # validate + scrape (no scrapea si hay FAIL)
```

En desarrollo, sin compilar: `pnpm --filter @cordoba/scraper run run` (usa `tsx`).

**Validador:** la página responde → el `<script>` del bundle sigue ahí → el sheet ID es el mismo →
las 15 columnas no cambiaron. FAIL: `bundle_missing`, `sheet_id_changed`, `schema_changed`,
`gviz_unreachable`. WARN: `page_blocked`, `sheet_id_not_found`, `empty_sheet`. INFO: `bundle_changed`.
Con FAIL no se scrapea, para no marcar todos los eventos como `removed` por un cambio de origen.

**Qué escribe:**

| Archivo               | Contenido                                                                        |
| --------------------- | -------------------------------------------------------------------------------- |
| `data/raw/<día>.json` | snapshot gviz del día (local, ignorado por git)                                  |
| `data/events.jsonl`   | estado canónico, un evento por línea, ordenado por `id` (incluye `active=false`) |
| `data/changes.jsonl`  | log append-only: `added` / `updated` (con diff) / `removed` / `readded`          |
| `data/status.json`    | último run: validación, conteos, hash de esquema y de contenido                  |

Correr `scrape` dos veces con los mismos datos no genera cambios más allá de `last_seen`.

### Farmacias de turno — Colegio de Farmacéuticos

El cronograma anual de guardias obligatorias no es una API: es un `.xls` que circula por Drive. El
`export?format=xlsx` responde anónimo, pero el zip no es reproducible (cambia en cada descarga), así
que el detector de cambios compara el hash del **contenido normalizado**, no del binario.

Forma de la planilla (verificada contra el turnero 2026):

- Hoja `TURNERO <año>`: col A = día del mes y una columna por mes, cuya celda es el **número de turno
  (1..30)**. Hay una columna que repite el día, así que los meses se mapean por su encabezado y no
  por posición.
- Hojas `1`..`30`: col A = **sección** (viene sólo en la primera fila de cada sección: hay que
  arrastrarla) y col B = `NOMBRE - dirección Bº barrio`. En 2026: 851 farmacias en 16 secciones (la
  15 no existe), entre 24 y 34 por turno.
- **Cada farmacia pertenece a un solo turno**: el turno es un atributo de la farmacia, no una fila de
  calendario. El `id` es `sha1(celda normalizada)[:12]` porque los nombres se repiten.
- La rotación es un **ciclo de 30 días** exacto (`turno = (turno_anterior mod 30) + 1`, ancla
  `2026-01-02 → turno 1`). El validador lo verifica: un desvío es un cambio deliberado del Colegio o
  un typo, y en los dos casos queremos verlo.
- El corte nombre/dirección es heurístico (el primer guion con espacio, salteando el que antecede al
  barrio). Las filas sin guion se adivinan por el prefijo en mayúsculas y quedan marcadas con
  `parse_confidence: "baja"`. El crudo se conserva siempre en `raw`.
- **La planilla no dice de qué hora a qué hora corre la guardia.** La ventana se asume de 08:30 a
  08:30 del día siguiente, viaja declarada en cada respuesta con `confirmed: false` y se configura con
  `FARMACIAS_TURNO_START` / `FARMACIAS_TURNO_HORAS` / `FARMACIAS_TURNO_CONFIRMADO`. El código maneja
  el cruce de medianoche: a las 02:00 del martes sigue de turno la farmacia del lunes.

**Geocoding**, el artefacto caro del dataset: se hace una sola vez y la cache se commitea en
`data/farmacias/geocode.json`. Dos pasadas, en este orden:

1. **Georef** (`apis.datos.gob.ar`), el servicio oficial de direcciones normalizadas: acepta lotes
   (un POST resuelve 100 direcciones), no tiene rate limit y entiende la nomenclatura local
   —`Rep. De Siria` → `RCA DE SIRIA`—, que es justo donde Nominatim falla con esta planilla.
   Resolvió 606 de 728 en 9 requests.
2. **Nominatim** (OSM) para el resto, a 1 request por segundo, porque es el único con fallback por
   barrio. Devuelve 503 en tandas largas aunque se respete el límite: el geocoder reintenta con
   espera creciente, guarda la cache cada 25 direcciones y se puede cortar y retomar. Sin Georef
   primero, una corrida completa son horas y en CI no cierra.

Las abreviaturas se expanden antes de consultar (`Av.`, `Bv.`, `Gral.`, `Cnel.`…) y cada resultado se
valida contra la caja de la ciudad: un match en Buenos Aires se descarta. La precisión queda
registrada por farmacia (`exacta`, `calle`, `barrio`, `ninguna`) y viaja en las respuestas del MCP.

```bash
node apps/scraper/dist/index.js farmacias validate   # parsea y valida, sin escribir nada
node apps/scraper/dist/index.js farmacias ingest     # persiste data/farmacias/
node apps/scraper/dist/index.js farmacias geocode    # geocodifica lo que falte
```

Opciones: `--file <path>`, `--download`, `--url <url>`, `--year <aaaa>`; y para el geocoder
`--limit <n>`, `--retry-failed`, `--skip-georef`, `--skip-nominatim`.

**Validador:** están las 30 hojas de turno → el calendario cubre el año completo → la rotación
respeta el ciclo → cada turno tiene una cantidad razonable de farmacias → las secciones están en
rango → no hay filas duplicadas. FAIL: `turnos_faltantes`, `calendario_incompleto`, `turnos_vacios`.
WARN: `ciclo_roto`, `turnos_flacos`, `anio_inesperado`, `secciones_fuera_de_rango`,
`filas_duplicadas`. INFO: `parseo`. Con FAIL **no se persiste nada**, para no dar de baja 851
farmacias por un archivo mal exportado.

**Qué escribe:**

| Archivo                                 | Contenido                                                                   |
| --------------------------------------- | --------------------------------------------------------------------------- |
| `data/raw/farmacias/turnero-<año>.xlsx` | la planilla original (local, ignorada por git)                              |
| `data/farmacias/pharmacies.jsonl`       | una farmacia por línea, ordenada por `id`, con turno, sección y coordenadas |
| `data/farmacias/turnos.json`            | un calendario por año: `fecha -> turno`, más el ancla del ciclo             |
| `data/farmacias/geocode.json`           | cache de geocoding por dirección normalizada                                |
| `data/farmacias/changes.jsonl`          | log append-only: altas, bajas y cambios de turno con diff                   |
| `data/farmacias/status.json`            | último run: validación, conteos, años cargados y hash de contenido          |

Las coordenadas no entran al `content_hash`: volver a geocodificar no genera un `updated` espurio.

## Los datos viven en R2

El Worker **no lleva los datos adentro**: los lee del bucket de R2 que declara `wrangler.jsonc`
(binding `DATA`). Así un dato nuevo no depende de un deploy del código, y el bundle no crece con cada
colección. El layout lo escribe `apps/worker/scripts/sync-r2.mjs`:

```
manifest.json                      lo único mutable: por colección, qué objeto es cada
                                   archivo y el hash de su contenido
eventos/records.jsonl
eventos/status.json
farmacias_turno/records.jsonl
farmacias_turno/status.json
farmacias_turno/turnos.json
```

Las claves son **estables** (se sobrescriben, no se acumulan versiones) y el hash del manifest es la
versión de caché: el Worker cachea cada objeto en el edge con la clave `<key>?v=<hash>`, así que una
entrada no se invalida, caduca. El manifest se cachea 60 s por isolate —esa es la latencia máxima con
la que un dato nuevo llega al MCP— y se sube **último**, cuando los objetos que referencia ya están
arriba.

Sin respaldo embebido, a propósito: si R2 no responde, las colecciones quedan en `null`, `search` y
`get` contestan `source_unavailable`, `/api/*` devuelve 503 y `/health` publica el error en
`data_source.error`. Si había un snapshot bueno en el isolate, se sigue sirviendo hasta el próximo
intento.

```bash
pnpm --filter @cordoba/worker run sync-r2            # sube data/ a R2 (necesita credenciales)
pnpm --filter @cordoba/worker run sync-r2 --dry-run
pnpm --filter @cordoba/worker run seed-r2            # el R2 simulado de wrangler dev
pnpm --filter @cordoba/worker run smoke [url]        # cliente MCP real contra un deploy
```

**El bucket lo crea la Action:** `sync-r2.mjs --ensure-bucket` lo crea si no existe y no hace nada si
ya está. A mano: `pnpm --filter @cordoba/worker exec wrangler r2 bucket create cordoba-mcp-data`. El
token necesita `Workers R2 Storage: Edit`, y la cuenta tiene que tener **R2 activado** una vez desde
el dashboard (eso no lo arregla ningún permiso; el script distingue los dos errores).

## Deploy en Cloudflare

Un único Worker (`cordoba-agenda`) sirve todo en **<https://cordobamcp.com>**, más la URL de
`*.workers.dev`, que queda activa porque la Action la usa para el smoke test inmediato sin esperar la
propagación del dominio. El Custom Domain (`routes` en `wrangler.jsonc`) crea el DNS y emite el
certificado solo, pero la zona tiene que estar en la **misma cuenta** que el Worker.

| Ruta      | Qué sirve                                                       |
| --------- | --------------------------------------------------------------- |
| `/`       | la landing de Astro (assets estáticos, binding `ASSETS`)        |
| `/mcp`    | MCP por streamable HTTP (sólo POST; sin SSE ni Durable Objects) |
| `/health` | una fila por colección                                          |
| `/api/…`  | los datasets crudos (ver [api.md](api.md))                      |

```bash
pnpm deploy                                      # wrangler deploy
pnpm --filter @cordoba/worker run smoke          # recorre toda la superficie contra el deploy
npx @modelcontextprotocol/inspector              # a mano
```

### En qué cuenta se despliega

`wrangler whoami` muestra con qué login estás y qué cuentas ve ese login. El nombre de la cuenta no
tiene nada que ver con el mail: un login puede ser miembro de varias, y el deploy va a la que se
resuelva en este orden:

1. `--account <id>` en `pnpm bootstrap`
2. la variable `CLOUDFLARE_ACCOUNT_ID`
3. si el login ve una sola cuenta, esa
4. si ve varias, el bootstrap te hace elegir (nunca decide solo)

El prompt de confirmación nombra la cuenta y el id antes de publicar.

```bash
pnpm bootstrap --account <account-id>
CLOUDFLARE_ACCOUNT_ID=<id> pnpm deploy
```

Para desplegar con otro login hay dos caminos: `wrangler logout` + `wrangler login` (cambia la
credencial global, `~/.config/.wrangler`), o un **API token** de la cuenta destino
(_My Profile → API Tokens → Create Token → Edit Cloudflare Workers_), que no toca nada global y sirve
igual en local y en CI:

```bash
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
pnpm deploy
```

El token tiene prioridad sobre el OAuth guardado, así que es la opción recomendada cuando manejás más
de una cuenta: es exactamente lo que usa la Action.

## Automatización

- **`scrape.yml`** — todos los días a las 06:17 de Córdoba: tests → build → `validate` → `scrape` →
  commit de `data/`. Si la validación falla, abre **un solo** issue con la label `scraper-alert` y no
  commitea.
- **`farmacias.yml`** — dos caras, porque el turnero es un archivo anual y no un feed. El cron del
  día 5 de cada mes sólo baja la planilla y compara el hash de contenido, y abre un issue (label
  `farmacias-alert`) si cambió **o si desde octubre no está el turnero del año siguiente** —sin ese
  aviso el dataset se degrada en silencio el 1 de enero—. La ingesta se dispara a mano
  (`workflow_dispatch` con `ingest: true`): valida, geocodifica lo nuevo y commitea. El paso de
  geocoding es `continue-on-error`: si Nominatim nos limita a mitad de camino, lo resuelto se
  commitea igual y el próximo run retoma.
- **`sync-data.yml`** — sube `data/` a R2, que es **lo que publica un dato nuevo**. Lo llaman los dos
  workflows de scrape cuando commitearon datos (los push con `GITHUB_TOKEN` no disparan workflows,
  así que lo invocan como workflow reutilizable) y se corre a mano desde Actions para la primera
  carga. Después verifica contra `/health` que las colecciones estén disponibles, reintentando 2
  minutos.
- **`deploy.yml`** — lint + tests + build, asegura el bucket de R2, publica el Worker y verifica
  `/health` y las tools contra la URL desplegada. Se dispara con un push a `main` o a mano. **No** se
  dispara por cambios en `data/`: el deploy es sólo para código.

Las credenciales viven en el **environment `prod`** del repo (Settings → Environments → `prod`), no
como secrets del repositorio: el job `deploy` declara `environment: prod` y es el único que las ve.

| Secret                  | Para qué                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | permisos **Workers Scripts: Edit** (deploy) y **Workers R2 Storage: Edit** (datos) |
| `CLOUDFLARE_ACCOUNT_ID` | el account id de la cuenta de Cloudflare                                           |

Con dominio propio el token necesita además, acotado a la zona: `Zone → Workers Routes: Edit` y
`Zone → Zone: Read`. La plantilla _Edit Cloudflare Workers_ ya los trae; un custom token mínimo, no,
y el deploy falla al crear la ruta.

El smoke test posterior al deploy usa el `deployment-url` que informa `wrangler-action`, que con un
Custom Domain viene como `cordobamcp.com (custom domain)` —sin esquema y con el sufijo literal—, así
que el workflow lo normaliza y reintenta 3 minutos (un certificado recién emitido tarda en
responder). Para forzar otra URL, la **variable** (no secret) `PROD_URL`.

## Notas

- `data/raw/` no se commitea: son los snapshots crudos, útiles para debug local. Lo que se publica
  son los datasets normalizados.
- Los entrypoints fuerzan `ipv4first` en el resolver DNS: en WSL2 y en runners sin IPv6 real, `fetch`
  a `documentos.cordoba.gob.ar` queda colgado esperando AAAA.
- El split real es **scraper (Node, escribe) vs worker (edge, lee)**.
