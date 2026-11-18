# Cómo se mide el impacto del proyecto

El proyecto publica datos abiertos; la medición sigue el mismo criterio: **agregados, sin
cookies y sin identificadores persistentes**. Todo queda dentro de la infraestructura que ya
hospeda el proyecto (Cloudflare): no se suma ningún proveedor de analítica externo, y nada de lo
que se guarda identifica a una persona.

## Qué se mide

| Pregunta                                       | De dónde sale                                   |
| ---------------------------------------------- | ----------------------------------------------- |
| Visitas, referrers, países, Core Web Vitals    | Cloudflare Web Analytics (beacon en la landing) |
| Clicks en los CTA y en "copiar la dirección"   | `POST /api/beacon` → Analytics Engine           |
| Sesiones del MCP por día                       | cada `initialize` en `/mcp`                     |
| Qué clientes se conectan (y en qué versión)    | `clientInfo.name` / `.version` del `initialize` |
| Tools más usadas y colecciones más consultadas | `tools/call` + el argumento `collection`        |
| Qué consultas fallan (qué datos faltan)        | el código de error JSON-RPC de cada respuesta   |
| Visitantes aproximados                         | hash diario de IP + user agent                  |

El embudo que importa es **visita → `copiar_endpoint` → primer `initialize`**: es la única forma
de saber cuánta gente que llega a la landing termina con el servidor conectado.

## Qué NO se mide

No hay cuentas ni auth en `/mcp`: **"usuarios" no existe como dato**. Lo más cercano es el
hash diario del visitante (`blob10`), que rota a medianoche en hora de Córdoba a propósito: sirve
para separar una sesión nueva de varias llamadas de la misma, y no permite seguir a nadie entre
días. La IP cruda no se guarda en ningún lado, no hay cookies, no hay `localStorage` y la landing
respeta `Do Not Track` / `Global Privacy Control` (si el navegador los manda, no emite eventos).

## Las tres piezas

1. **Cloudflare Web Analytics** — no hay nada en el repo: el dominio está en Cloudflare, así que
   el beacon se activa desde el dashboard (Analytics & Logs → Web Analytics → _automatic setup_)
   y se inyecta en el edge. Agregar además el `<script>` a mano contaría cada pageview dos veces.
   La contracara es que es configuración viva, no versionada: si alguien lo desactiva, la landing
   deja de medir y el repo no lo refleja.
2. **Eventos de la landing** — `apps/web/src/lib/analitica.ts`. Un listener delegado: cualquier
   elemento con `data-evento="nombre"` se reporta al hacer click, con `navigator.sendBeacon` para
   que el evento sobreviva a la navegación. Los nombres válidos son `WEB_EVENTS` de
   `packages/core/src/analytics.ts` (más el patrón `via_<id>`); el Worker descarta el resto,
   porque `/api/beacon` es público.
3. **Telemetría del MCP** — `apps/worker/src/analytics.ts`, un punto en Workers Analytics Engine
   por cada request JSON-RPC. El esquema del dataset está documentado en el encabezado de ese
   archivo y **las posiciones de los blobs no se reordenan nunca**: para sumar un campo se agrega
   un blob al final, así una consulta vieja sigue leyendo lo mismo.

El binding (`ANALYTICS`) es opcional en los dos casos: sin él el Worker responde igual, sólo no
mide. El dataset se crea solo en el primer `writeDataPoint`, así que no hay nada que aprovisionar.

Web Analytics y el dataset propio no se solapan: el primero mide **tráfico** (cuánta gente llega
y qué tan rápido carga) y no sabe nada de eventos propios ni del MCP, que no pasa por el browser.
El embudo y todo lo del MCP sólo pueden salir del dataset propio.

## Consultar los datos

Cloudflare Web Analytics se ve en el dashboard. El dataset propio se consulta con la API SQL de
Analytics Engine (necesita un API token con permiso _Account Analytics: Read_):

```bash
curl -s "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --data "SELECT ..."
```

Consultas que contestan las preguntas de arriba:

```sql
-- Sesiones del MCP por día (un initialize = un cliente que se conectó)
SELECT toDate(timestamp) AS dia, sum(_sample_interval) AS sesiones
FROM cordoba_mcp_uso
WHERE blob1 = 'mcp' AND blob2 = 'initialize' AND timestamp > now() - INTERVAL '30' DAY
GROUP BY dia ORDER BY dia;

-- Qué clientes se conectan
SELECT blob5 AS cliente, sum(_sample_interval) AS sesiones
FROM cordoba_mcp_uso
WHERE blob1 = 'mcp' AND blob2 = 'initialize' AND timestamp > now() - INTERVAL '30' DAY
GROUP BY cliente ORDER BY sesiones DESC;

-- Tools y colecciones más usadas
SELECT blob3 AS tool, blob4 AS coleccion, sum(_sample_interval) AS llamadas
FROM cordoba_mcp_uso
WHERE blob1 = 'mcp' AND blob2 = 'tools/call' AND timestamp > now() - INTERVAL '30' DAY
GROUP BY tool, coleccion ORDER BY llamadas DESC;

-- Qué falla (la lista de pendientes del proyecto, ordenada por demanda)
SELECT blob3 AS tool, blob4 AS coleccion, blob8 AS codigo, sum(_sample_interval) AS errores
FROM cordoba_mcp_uso
WHERE blob1 = 'mcp' AND blob7 = 'error' AND timestamp > now() - INTERVAL '30' DAY
GROUP BY tool, coleccion, codigo ORDER BY errores DESC;

-- Visitantes distintos por día (aproximado: el hash rota a medianoche)
SELECT toDate(timestamp) AS dia, count(DISTINCT blob10) AS visitantes
FROM cordoba_mcp_uso
WHERE timestamp > now() - INTERVAL '30' DAY GROUP BY dia ORDER BY dia;

-- El embudo de la landing
SELECT blob2 AS evento, sum(_sample_interval) AS eventos
FROM cordoba_mcp_uso
WHERE blob1 = 'web' AND timestamp > now() - INTERVAL '30' DAY
GROUP BY evento ORDER BY eventos DESC;
```

`sum(_sample_interval)` y no `count()`: Analytics Engine muestrea cuando el volumen crece, y esa
columna es el peso de cada fila. Con el volumen actual vale 1, pero la consulta queda correcta
para cuando no.

La retención del dataset es de 90 días. Para la serie histórica larga conviene guardar el
agregado mensual a mano (o con un cron) en algún lado estable.

## Lo que no es telemetría

Parte del impacto no se mide con requests y se revisa a mano, por trimestre: estrellas, forks e
issues del repo, si el servidor queda listado en el directorio de MCP de Claude, menciones
públicas, y sobre todo **qué organismos u organizaciones adoptan el endpoint**.
