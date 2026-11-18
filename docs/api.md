# La API: cuatro tools y un catálogo

El servidor vive en **<https://cordobamcp.com/mcp>**, habla MCP por streamable HTTP y es **stateless**:
cada POST se contesta con un JSON, sin sesiones ni Durable Objects. Todo el catálogo se consulta con
cuatro tools, y esa superficie **no cambia cuando se suman datos**.

## El eje es la colección, no la fuente

Una **colección** es un tipo de registro (`eventos`, `farmacias_turno`) y puede alimentarse de varias
fuentes a la vez: `eventos` puede venir de la Municipalidad, de Turismo de la Provincia y de Cultura,
y un mismo organismo puede alimentar varias colecciones. Por eso el primer parámetro es la colección
y `source` es un filtro opcional: el cliente no tiene que saber qué organismo publica qué, y sumar
una fuente nueva no cambia nada de lo que ve.

## Las cuatro tools

| Tool               | Parámetros                                                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_collections` | `collection?`, `include?` (`sources`, `examples`, `taxonomies`)                                                                                                |
| `search`           | `collection`, `query?`, `date?{from,to,include_past}`, `near?{lat,lon,radius_km}`, `filters?`, `source?`, `group_by?`, `sort?`, `fields?`, `limit?`, `cursor?` |
| `get`              | `ids[]` (con prefijo de colección), `expand?`                                                                                                                  |
| `source_status`    | `collection?`                                                                                                                                                  |

Más un resource de URI fija, `cordoba://catalog`: lo que crece es su contenido, no la lista de
resources.

`list_collections` es el discovery: qué colecciones hay, qué filtros declara cada una, sus taxonomías,
sus fuentes y qué tan fresca está. Si el modelo no reconoce una colección o un filtro, llama ahí en
vez de adivinar.

Colecciones de hoy:

| Colección         | Fuente                                                       | Filtros declarados                          |
| ----------------- | ------------------------------------------------------------ | ------------------------------------------- |
| `eventos`         | Agenda Turística – Municipalidad de Córdoba                  | `category`, `free_only`, `include_inactive` |
| `farmacias_turno` | Cronograma de Guardias – Colegio de Farmacéuticos de Córdoba | `on_duty`, `barrio`, `turno`, `seccion`     |

## Convenciones

- **Fechas:** instantes en ISO 8601 con offset de Córdoba (`2026-11-18T20:00:00-03:00`), fechas sin
  hora en `aaaa-mm-dd`. La entrada acepta los tokens relativos que declara cada colección (`hoy`,
  `mañana`, `ahora`, `fin_de_semana`) y la respuesta siempre devuelve `resolved` con lo que se
  interpretó. Todo se resuelve en `America/Argentina/Cordoba` (UTC-3 todo el año).
- **Coordenadas:** `lat`/`lon` (nunca `lng`), `radius_km` de entrada, `distance_km` de salida, más la
  precisión del geocoding por registro. Una colección sin coordenadas responde `unsupported` en vez
  de ignorar el `near`.
- **Paginación:** `limit` (default 20, máx 100) y `cursor` opaco. La respuesta trae `count`, `total`,
  `truncated` y `next_cursor`.
- **Ids:** `<collection>:<source>:<id_local>`, que es lo que `get` espera; un id pelado se acepta
  mientras no sea ambiguo. El prefijo se arma al serializar.
- **Errores:** una sola forma, con `isError: true`:
  `{ "error": { "code", "message", "hint", "valid_values" } }`. Códigos: `unknown_collection`,
  `unknown_filter`, `invalid_filter_value`, `invalid_date`, `invalid_cursor`, `invalid_id`,
  `source_unavailable`, `not_found`, `unsupported`. `valid_values` convierte el error en discovery:
  el modelo se corrige sin tener que llamar a `list_collections`.
- **Envelope:** igual en todas las respuestas, con `service`, `collection`, `sources[]` (nombre, url,
  licencia y `data_as_of` de cada una), `timezone`, `catalog_version` y `notes`. Los supuestos del
  dominio —por ejemplo, que la planilla del Colegio no dice de qué hora a qué hora corre la
  guardia— viajan como `notes` de la colección.
- **Claves de respuesta en inglés**, salvo los términos del dominio sin traducción útil (`turno`,
  `barrio`, `seccion`).

## Por qué la superficie está congelada

Lo que obliga a un cliente a reconectar no es un deploy —con streamable HTTP sin estado, el isolate
nuevo atiende el próximo POST y el cliente no nota nada—, sino que cambie lo que se entrega en el
handshake. Son tres cosas, y las tres están congeladas a propósito:

1. **`tools/list`:** cuatro tools. Una colección nueva no la toca.
2. **`instructions` del `initialize`:** queda pegada a la sesión, así que **no nombra fuentes ni
   colecciones concretas** (`SERVER_INSTRUCTIONS`, en `packages/core/src/branding.ts`). Si las
   nombrara, cada fuente nueva dejaría mintiendo a los clientes ya conectados.
3. **`resources/list`:** un resource de URI fija cuyo contenido crece.

Consecuencias:

- Agregar datos (una colección, una fuente dentro de una colección, un filtro declarado en un
  descriptor) es **siempre compatible** y no necesita aviso: el modelo lo descubre con
  `list_collections`, y `catalog_version` viaja en cada respuesta para que note que cambió.
- No hay canal server→client: con la superficie congelada no hay nada que notificar, el servidor no
  declara `listChanged` y el `GET /mcp` devuelve `405` (la spec lo contempla).
- Un cambio incompatible en una de las cuatro tools se trata como lo que es: un evento raro, que va
  en una versión mayor y se anuncia en el README y en la landing.

`serverInfo.version` sale de una sola fuente: el campo `version` de `packages/core/package.json`,
exportado como `SERVER_VERSION` / `SERVER_INFO` desde `@cordoba/core`.

## Sumar una fuente

Dos piezas, y ninguna toca las tools:

1. Implementar la interfaz `Source` de `packages/core/src/sources/base.ts`: cómo se baja el origen,
   cómo se valida que no cambió de forma y cómo se normaliza al modelo común.
2. Registrar un **descriptor de colección** en `packages/core/src/collections/`: id, nombre,
   organismo, url, licencia, colecciones que alimenta, campos del resumen, qué soporta
   (`text`, `near`, `date_range`, `pagination`), claves de orden y de `group_by`, taxonomías y los
   filtros declarados (nombre, tipo, enum o rango, default, descripción).

`search` valida los `filters` contra el descriptor en runtime y devuelve `unknown_filter` con
`valid_values`; `list_collections` publica el descriptor; las rutas HTTP y `/health` se generan
iterando el catálogo, así que una colección nueva aparece sola.

Pendiente: deduplicación entre fuentes de una misma colección y geocodificación de venues.

## Rutas HTTP

Para consumir los datos sin MCP:

| Ruta                               | Qué devuelve                                     |
| ---------------------------------- | ------------------------------------------------ |
| `/api/{collection}.jsonl`          | los registros de una colección, NDJSON           |
| `/api/{collection}/status.json`    | el estado del último run de esa colección        |
| `/api/farmacias_turno/turnos.json` | los calendarios `fecha -> turno` por año         |
| `/health`                          | una fila por colección, con conteos y validación |

Las rutas viejas (`/api/events.jsonl`, `/api/status.json`, `/api/farmacias.jsonl`,
`/api/farmacias/status.json`, `/api/farmacias/turnos.json`) siguen respondiendo como alias.
`POST /api/beacon` no devuelve datos: recibe los eventos de la landing (ver
[analitica.md](analitica.md)).
