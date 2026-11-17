# Firma estandarizada de tools (propuesta)

**Estado:** **implementado** (rev. 3, 2026-11-17). Las secciones 1 y 5–7 quedan como registro del
punto de partida y del razonamiento; lo que describen las secciones 2–4 es lo que hay en el código.
Diferencias con la propuesta original: la tool de discovery se llama `list_collections` (no
`list_sources`), los ids se arman al serializar (los `.jsonl` siguen guardando el id local, así que
no hubo migración de datos), y las 11 tools anteriores se borraron de una en vez de quedar como
alias.
**Objetivo:** una superficie de tools chica y **congelada**, para que abstraer el resto de los datos públicos de Córdoba sea agregar _datos_, no tools. Criterio de éxito: **sumar una fuente no obliga al usuario a reconectar el MCP**, y el costo de mantenimiento por fuente nueva es un archivo más una fila de registro.
**Alcance:** solo el camino remoto (`apps/worker`, `https://cordobamcp.com/mcp`). El servidor stdio sale de escena. Nada de modelos de cobro.

> **Supuesto declarado:** la lista de casos de uso llegó con los `[completar: …]` vacíos. Usé los que ya están en `packages/core` más las fuentes de `informe-fuentes-cordoba-mcp.md` y el `near()` pendiente de `plan.md`. No inventé fuentes.

---

## 1. Inventario de las tools actuales

Definidas en `packages/core/src/tools.ts`, servidas por `apps/worker` (y hoy también por `apps/mcp`).

| Tool                 | Parámetros                                                                                 | Retorno (dentro del envelope)                                                                                                 | Fuente                  |
| -------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `search_events`      | `query`, `category`, `date_from`, `date_to`, `free_only`, `include_past`, `limit≤100 (20)` | `count`, `events[]` (descripción truncada a 300)                                                                              | agenda (`turismo_muni`) |
| `events_on`          | `date` (requerido)                                                                         | `date`, `count`, `events[]`                                                                                                   | agenda                  |
| `this_weekend`       | `free_only`, `category`                                                                    | `range{from,to}`, `count`, `events[]`                                                                                         | agenda                  |
| `get_event`          | `id`                                                                                       | `event` + `link` (a la agenda, no al evento)                                                                                  | agenda                  |
| `list_categories`    | —                                                                                          | `categories[]{category,count}`                                                                                                | agenda                  |
| `source_status`      | —                                                                                          | `agenda{…}`, `farmacias{…}`                                                                                                   | las dos                 |
| `pharmacies_on_duty` | `date`, `barrio`, `near_lat`, `near_lon`, `limit≤200 (25)`                                 | `turno`, `turno_derivado_del_ciclo`, `service_date`, `window`, `total_del_turno`, `count`, `sin_geocodificar`, `pharmacies[]` | farmacias               |
| `pharmacies_near`    | `lat`, `lon`, `radius_km (3)`, `date`, `limit≤50 (10)`                                     | ídem + `radius_km`                                                                                                            | farmacias               |
| `duty_turno_on`      | `date`                                                                                     | `turno`, `service_date`, `window`, `count`, `sections[]`                                                                      | farmacias               |
| `find_pharmacy`      | `query`, `limit≤50 (10)`                                                                   | `count`, `pharmacies[]` + `next_duty_dates`                                                                                   | farmacias               |
| `get_pharmacy`       | `id`                                                                                       | `pharmacy` + `next_duty_dates`                                                                                                | farmacias               |

**Inconsistencias**

1. **Nombres:** tres verbos para lo mismo (`search_events`, `find_pharmacy`, `pharmacies_near`) y dos patrones de sufijo (`events_on` vs `duty_turno_on`); el recurso va de prefijo (`get_event`) o de sufijo (`pharmacies_on_duty`).
2. **Claves mezclan idiomas:** `count`, `window`, `sections` junto a `total_del_turno`, `turno_derivado_del_ciclo`, `sin_geocodificar`.
3. **Fechas:** `events_on.date` es requerido y acepta `hoy|mañana|aaaa-mm-dd`; el `date` de farmacias es opcional y acepta además `ahora`. Eventos devuelven ISO con offset; farmacias, `service_date` en `aaaa-mm-dd` más ventana ISO. Nunca se devuelve la fecha _resuelta_ de un token relativo.
4. **Coordenadas:** `near_lat`/`near_lon` en una tool, `lat`/`lon` en otra, `lng` en `plan.md`.
5. **Paginación:** no hay. Solo `limit`, con tres techos (50/100/200) y tres defaults (10/20/25). `count` es "lo que devolví" y solo farmacias informa el total (`total_del_turno`).
6. **Errores:** `{ error: "<texto libre>" }` + `isError: true`, sin código estable, y con mensajes operativos que no le sirven al usuario final (`Corré cordoba-scraper farmacias ingest`).
7. **Ids sin prefijo de fuente:** `eventId()` da sha1 de 12 hex; farmacias usan `baseId` con sufijo `-2`. Un id suelto no dice de qué colección es, y dos fuentes pueden colisionar.
8. **Envelope con forma variable:** farmacias agrega `turno_window` y `disclaimer`; no viaja el `source_id`. `source_status` está declarada `dataset: "agenda"`, así que la respuesta que habla de las dos fuentes se acredita solo a la agenda.
9. **Política metida en la firma:** `this_weekend` fija "viernes 18:00 a domingo 23:59" en el nombre; `list_categories` expone la taxonomía de una sola fuente.
10. **El costo por fuente nueva está repartido.** Sumar farmacias tocó: `tools.ts` (5 tools + rama en `envelope`), el tipo `Snapshot` (campo nuevo), `apps/worker/src/index.ts` (armado del snapshot, `/health` y 3 rutas `/api/*`), `apps/mcp/src/server.ts` (`FARMACIAS_TOOL_NAMES` + ocultar tools) y `data.generated.ts`. Esos seis lugares son el verdadero problema de mantenimiento.

---

## 2. Firma propuesta: cuatro tools, `collection` como eje

**La clave es `collection` (qué tipo de registro), no `source` (qué organismo lo publica).** Son ejes distintos y la relación es muchos a muchos: Gobierno Abierto solo aporta barrios, paradas y espacios verdes (una fuente, tres colecciones), y `eventos` va a venir de tres fuentes a la vez (Muni, Turismo provincia, Cultura). Si el primer parámetro fuera la fuente, el modelo tendría que saber qué organismo publica qué —justo lo que el MCP debería ocultar— y la deduplicación de la sección 2.8 del relevamiento no tendría dónde vivir. Con `collection` primero y `source` como filtro opcional, "eventos gratis este finde" es una sola llamada que hace fan-out, dedupe y acredita a cada fuente en el envelope.

Colecciones previstas (7, y el namespace se mueve poco): `eventos`, `farmacias_turno`, `feriados`, `venues`, `barrios`, `paradas`, `clima`.

```json
{
  "name": "list_collections",
  "description": "Qué datos públicos de Córdoba hay disponibles: colecciones, filtros que acepta cada una, taxonomías, fuentes y frescura. Llamala si no reconocés una colección o un filtro.",
  "inputSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "collection": {
        "type": "string",
        "description": "id de colección; omitilo para listar todas"
      },
      "include": {
        "type": "array",
        "items": { "enum": ["filters", "taxonomies", "examples", "sources", "freshness"] }
      }
    }
  }
}
```

```json
{
  "name": "search",
  "description": "Busca registros en una colección (eventos, farmacias_turno, feriados, venues, …) por texto, fechas, filtros propios de la colección y cercanía a un punto. Los filtros válidos salen de list_collections.",
  "inputSchema": {
    "type": "object",
    "required": ["collection"],
    "additionalProperties": false,
    "properties": {
      "collection": { "type": "string" },
      "query": { "type": "string", "description": "texto libre" },
      "date": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "from": {
            "type": "string",
            "description": "aaaa-mm-dd | aaaa-mm-ddThh:mm | hoy | mañana | ahora | fin_de_semana"
          },
          "to": { "type": "string" },
          "include_past": { "type": "boolean", "default": false }
        }
      },
      "near": {
        "type": "object",
        "required": ["lat", "lon"],
        "additionalProperties": false,
        "properties": {
          "lat": { "type": "number", "minimum": -90, "maximum": 90 },
          "lon": { "type": "number", "minimum": -180, "maximum": 180 },
          "radius_km": { "type": "number", "minimum": 0.1, "maximum": 50 }
        }
      },
      "filters": {
        "type": "object",
        "additionalProperties": true,
        "description": "filtros de la colección, p. ej. {\"category\":\"musica\",\"free_only\":true} o {\"barrio\":\"Nueva Córdoba\"}"
      },
      "source": {
        "type": "string",
        "description": "limita a una fuente; por defecto consulta todas las de la colección"
      },
      "group_by": {
        "type": "string",
        "description": "clave de agregación declarada por la colección (p. ej. seccion, category)"
      },
      "sort": {
        "type": "string",
        "description": "clave de orden declarada (start | distance | relevance | …)"
      },
      "fields": { "type": "string", "enum": ["summary", "full"], "default": "summary" },
      "limit": { "type": "integer", "minimum": 1, "maximum": 100, "default": 20 },
      "cursor": { "type": "string" }
    }
  }
}
```

```json
{
  "name": "get",
  "description": "Trae registros completos por id con prefijo de colección (p. ej. eventos:turismo_muni:9f3c1a2b4d5e).",
  "inputSchema": {
    "type": "object",
    "required": ["ids"],
    "additionalProperties": false,
    "properties": {
      "ids": { "type": "array", "items": { "type": "string" }, "minItems": 1, "maxItems": 50 },
      "expand": {
        "type": "array",
        "items": { "type": "string" },
        "description": "datos derivados declarados por la colección, p. ej. next_duty_dates, venue"
      }
    }
  }
}
```

`source_status` queda igual de nombre, con `{ collection?: string }`, y lee el registro en vez de la lista hardcodeada de dos datasets.

**Convenciones comunes**

- **Fechas:** instantes en ISO 8601 con offset de Córdoba (`2026-11-18T20:00:00-03:00`); fechas sin hora en `aaaa-mm-dd`, en campos `*_date`. La entrada acepta tokens relativos resueltos en `America/Argentina/Cordoba` y la respuesta **siempre** incluye `resolved.date` con lo interpretado.
- **Coordenadas:** `lat`/`lon` en todo el repo (nunca `lng` ni `near_lat`), `radius_km` de entrada, `distance_km` con 2 decimales de salida, `geocode_precision` por registro y `without_coords` en el resultado.
- **Paginación:** `limit` (default 20, máx 100) + `cursor` opaco. Respuesta `{ items, count, total, next_cursor, truncated }`; `total` reemplaza a `total_del_turno`.
- **Errores:** una sola forma con `isError: true`: `{ "error": { "code", "message", "hint", "valid_values" } }`. Códigos: `unknown_collection`, `unknown_filter`, `invalid_filter_value`, `invalid_date`, `source_unavailable`, `not_found`, `unsupported`. `message` es para el usuario; lo operativo va en `hint`; `valid_values` convierte el error en discovery.
- **Ids:** `<collection>:<source>:<id_local>`, estables entre runs y opacos. Así `get` no necesita parámetro de colección.
- **Envelope único:** `{ collection, sources: [{ id, name, url, license, data_as_of }], timezone, catalog_version, notes: [], result: {…} }`. `turno_window` y el disclaimer de farmacias pasan a `notes` y al descriptor, en vez de ser ramas del envelope.
- **Claves de respuesta en inglés**, sin mezcla, salvo los términos del dominio sin traducción útil (`turno`, `barrio`, `seccion`).

---

## 3. El catálogo: una fuente nueva es una fila, no una tool

En `packages/core` cada fuente registra un **descriptor** al lado del `Source` que ya implementa: id, nombre, organismo, url, licencia, colecciones que alimenta, campos del resumen, `supports: { text, near, date_range, pagination }`, claves de orden y de `group_by`, taxonomías (las categorías de la agenda dejan de ser una tool) y la lista de **filtros declarados** (nombre, tipo, enum o rango, default, descripción). `search` valida `filters` contra el descriptor **en runtime** y devuelve `unknown_filter` con `valid_values`; `list_collections` publica el descriptor.

Lo que hay que lograr para que el costo por fuente sea real de una fila:

- **Un solo registro, sin ramas por fuente.** `Snapshot` deja de ser `{ agenda, farmacias }` tipado a mano y pasa a ser un mapa `collection -> store`. Eso elimina la rama de `envelope()`, el `NO_DATASET` especial y el armado a mano del snapshot en `apps/worker/src/index.ts`.
- **Rutas genéricas.** `/api/events.jsonl`, `/api/farmacias.jsonl`, `/api/farmacias/turnos.json` y sus `status.json` se vuelven `/api/{collection}.jsonl` y `/api/{collection}/status.json`, iteradas del registro. `/health` también se arma iterando (hoy lista agenda y farmacias a mano, más campos duplicados por compatibilidad).
- **Un recurso MCP fijo.** Hoy hay uno (`agenda://status`). Conviene uno solo, de URI inmutable (`cordoba://catalog`), cuyo **contenido** crezca: si crece la _lista_ de recursos, vuelve el mismo problema de caché que con las tools.
- **Datos fuera del bundle.** `data.generated.ts` ya pesa 616 KB con dos fuentes; con paradas (5.554), barrios, venues y feriados no cierra contra el límite de bundle del Worker. Dos caminos: dejar los datos como **assets estáticos** (el binding `ASSETS` ya existe; cero infra nueva, pero cada actualización sigue siendo un deploy) o **R2 + manifest** con `cache` en el Worker (cada fuente actualiza en su propio cron, sin deploy del servidor). Recomiendo R2: es lo que desacopla la frecuencia de cada fuente del deploy del código.

---

## 4. Por qué nada de esto hace reconectar (y qué se puede borrar)

Lo que obliga a un cliente a reconectar **no es el deploy**: con streamable HTTP sin estado, cada POST es independiente y el isolate nuevo atiende el siguiente request sin que el cliente note nada (y, según el comentario medido en `sse.ts`, un deploy ni siquiera corta los streams abiertos). Lo que deja desactualizado al cliente es que cambie **lo que entregamos en el handshake y en `tools/list`**. Son tres cosas, y conviene congelar las tres:

1. **`tools/list`.** Con cuatro tools fijas, agregar `feriados` o `venues` no la toca. Este es el requisito, y se cumple por construcción.
2. **`instructions` del `initialize`.** Hoy dice _"Agenda de eventos de la ciudad de Córdoba"_: queda pegada a la sesión y, si sumás farmacias o feriados, el cliente conectado sigue leyendo una descripción que miente. Debe volverse genérica y apuntar al discovery: "datos públicos de Córdoba; usá `list_collections` para ver qué hay".
3. **`resources/list`.** Mismo razonamiento: un recurso de URI fija cuyo contenido crece.

**El efecto de segundo orden es la simplificación que pedís.** Toda la maquinaria de aviso existe solo para el caso "cambió la lista de tools": `apps/worker/src/sse.ts` (~125 líneas, el código más delicado del repo: TTL porque `request.signal` no dispara, keepalive con `id:` y `data:` no vacía, lectura de `Last-Event-ID`), el `TOOLS_REVISION` adentro del `Mcp-Session-Id`, `needsListChanged`, `revisionOf`, la var `MCP_SSE_TTL_S` y el `GET /mcp` con SSE. Con la superficie congelada, eso nunca se dispara. Se puede dejar el `GET /mcp` devolviendo 405 (la spec lo contempla y el SDK lo trata como caso esperado) y borrar el resto, o conservarlo apagado como escape hatch para el cambio de tools que pase una vez al año. Yo lo borraría **después** de la migración, no antes.

**La staleness que queda** es distinta y no se arregla con notificaciones: el modelo tiene en su contexto el resultado de un `list_collections` viejo. Para eso alcanza que `catalog_version` viaje en cada envelope y que `unknown_collection`/`unknown_filter` devuelvan siempre la lista vigente: el modelo se corrige en una llamada, sin reconectar y sin protocolo extra.

**Solo remoto: qué desaparece.** `apps/mcp` entero (stdio), `SnapshotCache` con su doble camino `url`/`path`, las env `AGENDA_DATA_PATH`/`AGENDA_DATA_URL`, el flag `CORDOBA_MCP_HIDE_UNAVAILABLE_TOOLS` con su `syncToolsWithSnapshot` (ocultar tools deja de tener sentido: una colección caída es un dato del catálogo, no un cambio de superficie) y el doble entrypoint `@cordoba/core` vs `@cordoba/core/web`. Ojo: el scraper sigue corriendo en Node y usando `fs`, así que el split pasa a ser **scraper (Node, escribe) vs worker (edge, lee)**, que es más limpio que los tres consumidores de hoy, pero no es "core sin Node".

---

## 5. Mapeo de los casos de uso

| Caso de uso                                 | Cómo se resuelve                                                                                                                                                                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eventos de la ciudad                        | `search(collection:"eventos", query, date, filters:{category, free_only})`                                                                                                                                                         |
| Eventos de un día (`events_on`)             | `date:{from:"hoy", to:"hoy"}`                                                                                                                                                                                                      |
| Fin de semana (`this_weekend`)              | `date:{from:"fin_de_semana"}`; la política vive en `resolveDateInput`, no en el nombre de la tool                                                                                                                                  |
| Detalle (`get_event`, `get_pharmacy`)       | `get(ids:[…], expand:["next_duty_dates"])`                                                                                                                                                                                         |
| Categorías (`list_categories`)              | `list_collections(collection:"eventos", include:["taxonomies"])`, con conteos                                                                                                                                                      |
| Farmacias de turno, por barrio, cerca       | `search(collection:"farmacias_turno", filters:{barrio}, near:{…}, date:{from:"ahora"})`                                                                                                                                            |
| Qué turno está de guardia (`duty_turno_on`) | `group_by:"seccion"` sobre la misma colección: devuelve el agregado sin listar las 850                                                                                                                                             |
| Eventos de la provincia (Córdoba Turismo)   | fuente nueva dentro de `eventos`. **Ni el catálogo de colecciones cambia**                                                                                                                                                         |
| Teatros y museos provinciales (Cba Cultura) | ídem; la deduplicación es un paso de ingest (campo `also_in`), no una tool                                                                                                                                                         |
| Feriados                                    | colección `feriados`: `search(collection:"feriados", date:{from,to})`                                                                                                                                                              |
| Venues con coordenadas (SInCA)              | colección `venues` con `near`; y `get(..., expand:["venue"])` desde un evento                                                                                                                                                      |
| Filtros geográficos sobre eventos           | el bloque `near` ya está en la firma: cuando la agenda tenga venue geocodificado deja de responder `unsupported`, **sin cambio de schema**                                                                                         |
| Consultas cruzadas                          | dos `search` encadenados por `lat`/`lon` del lado del cliente. La firma no hace joins (decisión D3)                                                                                                                                |
| Transporte (paradas / GTFS)                 | colección `paradas` con `near`. El GTFS del relevamiento está vencido: es problema de datos, no de firma                                                                                                                           |
| Clima (Open-Meteo)                          | **no encaja**: es una función de (punto, fecha), no un corpus buscable. Ajuste mínimo: colección `clima` con `near` obligatorio y `date` como rango, un registro por día — se estira la semántica de "buscar", pero no agrega tool |
| Geocodificación (Georef)                    | **no encaja**: es un resolver, no una colección. Ajuste mínimo: aceptar `near.address` en `search` y geocodificar en el core, sin exponer el geocoder                                                                              |

---

## 6. Migración (cómo se hizo)

Se hizo en una sola tanda, no en dos versiones: las 11 tools anteriores se borraron junto con la
publicación de las nuevas. Un cliente con `tools/list` cacheado de antes recibe "no existe el tool"
hasta que reconecte; de ahí en adelante, que el catálogo crezca ya no le pide nada. También se
borraron, por quedar sin función: `apps/mcp` (el servidor stdio), `apps/worker/src/sse.ts`, el
`TOOLS_REVISION` dentro del `Mcp-Session-Id`, `needsListChanged`, la var `MCP_SSE_TTL_S` y el
`SnapshotCache` con su doble camino `url`/`path`. El `GET /mcp` devuelve 405.

Lo que sigue valiendo para cualquier cambio futuro:

- **Aditivo primero.** Agregar `list_collections`/`search`/`get` no rompe a nadie: el cliente con la lista cacheada sigue llamando las 11 actuales. Es el único momento en que _sí_ conviene que la notificación de `tools/list_changed` exista, porque es el último cambio de superficie que vas a hacer.
- **Convivencia una versión.** Las 11 quedan como adaptadores finos sobre `search`/`get` (misma firma de entrada, cero lógica propia), con la descripción empezando en `[DEPRECADA — usá search] …` y la respuesta conservando las claves viejas mientras exista el alias.
- **Lo que rompe:** quitar una tool o estrechar su schema deja al cliente cacheado llamando algo que no existe (por eso recién en la versión siguiente; agregar parámetros opcionales es seguro). Y **el prefijo en los ids es el único cambio de datos incompatible**: cualquier id guardado antes deja de resolver. Mitigación: `get` acepta ids sin prefijo durante la transición si no son ambiguos.
- **Orden sugerido:** registro + descriptores de las dos fuentes actuales → `Snapshot` como mapa → `list_collections`/`search`/`get` → `instructions` genéricas y recurso único → rutas `/api/{collection}` y `/health` iterados → datos a R2 → aliases deprecados → borrar `apps/mcp` y `sse.ts` → recién entonces sumar fuentes nuevas.
- **Checklist de "fuente nueva" al final del camino:** un `Source` + un descriptor + un cron. Sin tocar tools, ni el worker, ni el handshake.

---

## 7. Trade-offs

- **El modelo pierde señal.** `pharmacies_on_duty` se explica solo; `search(collection:"farmacias_turno")` requiere saber que esa colección existe. Mitigación: descripciones con los ids de colección y ejemplos literales embebidos, `include:["examples"]`, y la regla de que todo error de discovery devuelva `valid_values`.
- **Se pierde validación por JSON Schema.** Con `filters` abierto, `category:"jazz"` lo rechaza el runtime, no el schema. Es el precio exacto de no republicar schema por fuente nueva. Mitigación: validar temprano, un código por tipo de falla, y los enums más usados en la descripción.
- **Más llamadas en frío:** el camino "no conozco la colección" son dos llamadas. Se amortiza con un `list_collections` chico y cacheable.
- **Parar la abstracción acá, a propósito.** El gradiente sigue hacia un DSL de filtros y después hacia un `query` con SQL. Ahí el MCP se vuelve una API de base de datos genérica y se evapora lo que vale: la semántica de Córdoba ya resuelta (ciclo de 30 turnos, UTC-3 fijo, categorías canónicas, dedupe entre fuentes). `collection` + filtros declarados es el último escalón donde el modelo todavía puede acertar sin documentación.
- **Lo que se gana:** `tools/list` deja de crecer, el costo de contexto por tool se paga una vez, el aviso de cambios y sus ~125 líneas de SSE medido a mano se vuelven innecesarios, y una fuente nueva no llega al usuario como una reconexión.

---

## Decisiones tomadas

1. **D1 — `collection` como eje**, con `source` como filtro opcional. Es lo que habilita el fan-out
   y el dedupe dentro de `eventos` sin que el modelo tenga que saber qué organismo publica qué.
2. **D2 — `filters` abierto** (`additionalProperties: true`) validado en runtime contra el
   descriptor. El precio es la validación por schema; se compensa con `valid_values` en el error.
3. **D3 — Sin consultas cruzadas en la firma**: el cliente encadena dos `search` por `lat`/`lon`.
   `expand` queda para datos derivados de la propia colección (hoy, `next_duty_dates`).
4. **D4 — Prefijo en los ids, ya** (`<collection>:<source>:<id_local>`). Se arma al serializar, así
   que no hubo migración de datos; `get` acepta un id pelado mientras no sea ambiguo.
5. **D5 — Datos en R2 con manifest**, implementado. Claves estables más hash del contenido como
   versión de caché; el manifest se cachea 60 s por isolate (ésa es la latencia de un dato nuevo) y
   lo suben los workflows de scrape, no el de deploy. Sin respaldo embebido: si R2 no responde, las
   colecciones quedan `source_unavailable`.
6. **D6 — SSE y `TOOLS_REVISION` borrados**, no apagados. El mecanismo queda en el historial de git
   si alguna vez hay que volver a notificar un cambio de superficie.

**Lo que queda pendiente, en orden:** (a) la primera fuente nueva dentro de `eventos` (Córdoba
Turismo) y con ella la deduplicación de la sección 2.8 del relevamiento; (b) `venues` con
coordenadas, que es lo que habilita `near` en `eventos`.
