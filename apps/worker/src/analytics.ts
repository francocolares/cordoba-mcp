/**
 * Telemetría agregada sobre Workers Analytics Engine.
 *
 * Por qué Analytics Engine y no logs: `observability` da el detalle de las
 * últimas horas, pero con retención corta. Acá queremos la serie larga para
 * poder decir "el MCP creció 3x este trimestre", y para eso hace falta un
 * dataset con cardinalidad alta y consultas SQL.
 *
 * Esquema del dataset (`ANALYTICS_DATASET`). Las posiciones no se reordenan
 * nunca: una consulta vieja contra datos nuevos tiene que seguir leyendo lo
 * mismo. Para sumar un campo se agrega un blob al final.
 *
 * | campo    | mcp                                  | web                 |
 * |----------|--------------------------------------|---------------------|
 * | blob1    | "mcp"                                | "web"               |
 * | blob2    | método JSON-RPC (`tools/call`, …)    | nombre del evento   |
 * | blob3    | tool llamada                         | —                   |
 * | blob4    | colección consultada                 | —                   |
 * | blob5    | cliente (`clientInfo.name`)          | —                   |
 * | blob6    | versión del cliente                  | —                   |
 * | blob7    | "ok" | "error"                       | "ok"                |
 * | blob8    | código de error JSON-RPC             | —                   |
 * | blob9    | versión de protocolo pedida          | —                   |
 * | blob10   | hash diario del visitante            | ídem                |
 * | blob11   | país (header de Cloudflare)          | ídem                |
 * | blob12   | —                                    | ruta de la página   |
 * | double1  | 1 (para `sum(double1)`)              | ídem                |
 * | index1   | "mcp:<cliente>"                      | "web:<evento>"      |
 *
 * Nada de lo que se escribe identifica a una persona: ver el comentario de
 * `packages/core/src/analytics.ts`.
 */
import { isoDate, todayInCordoba } from "@cordoba/core/web";

export interface AnalyticsDataset {
  writeDataPoint(event: {
    blobs?: (string | null)[];
    doubles?: number[];
    indexes?: string[];
  }): void;
}

/** Tope de Analytics Engine para un index; lo usamos para todos los blobs. */
const MAX = 96;

const txt = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value.slice(0, MAX) : null;

const obj = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

/**
 * Pseudónimo del visitante: hash de IP + user agent + el día de hoy en
 * Córdoba. Rota a medianoche a propósito —no permite seguir a nadie entre
 * días— y alcanza para distinguir una sesión nueva de varias llamadas de la
 * misma. La IP cruda no se guarda en ninguna parte.
 */
export async function visitorId(request: Request, now: Date = new Date()): Promise<string> {
  const dia = isoDate(todayInCordoba(now));
  const ip = request.headers.get("cf-connecting-ip") ?? "";
  const ua = request.headers.get("user-agent") ?? "";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${dia}|${ip}|${ua}`),
  );
  return [...new Uint8Array(digest).slice(0, 8)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const pais = (request: Request): string | null => txt(request.headers.get("cf-ipcountry"));

interface McpCall {
  id: string;
  method: string | null;
  tool: string | null;
  collection: string | null;
  cliente: string | null;
  clienteVersion: string | null;
  protocolo: string | null;
}

/**
 * Un evento por request JSON-RPC del body (que puede ser un batch). Las
 * notificaciones también cuentan: `notifications/initialized` es la señal de
 * que un cliente terminó de conectarse.
 */
export function mcpCalls(payload: unknown): McpCall[] {
  const items = Array.isArray(payload) ? payload : [payload];
  const calls: McpCall[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const request = item as Record<string, unknown>;
    const params = obj(request["params"]);
    const args = obj(params["arguments"]);
    const cliente = obj(params["clientInfo"]);
    calls.push({
      id: String(request["id"] ?? ""),
      method: txt(request["method"]),
      tool: txt(params["name"]),
      collection: txt(args["collection"]),
      cliente: txt(cliente["name"]),
      clienteVersion: txt(cliente["version"]),
      protocolo: txt(params["protocolVersion"]),
    });
  }
  return calls;
}

/** Códigos de error de la respuesta, por id, para marcar qué request falló. */
function erroresPorId(response: unknown): Map<string, number> {
  const items = Array.isArray(response) ? response : [response];
  const mapa = new Map<string, number>();
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const res = item as Record<string, unknown>;
    const error = obj(res["error"]);
    const code = error["code"];
    if (typeof code === "number") mapa.set(String(res["id"] ?? ""), code);
  }
  return mapa;
}

/**
 * Escribe los eventos de un `POST /mcp`. Nunca lanza: una falla de telemetría
 * no puede cambiar la respuesta del MCP.
 */
export function recordMcp(
  dataset: AnalyticsDataset | undefined,
  args: { request: Request; payload: unknown; response: unknown; visitante: string },
): void {
  if (!dataset) return;
  try {
    const errores = erroresPorId(args.response);
    const country = pais(args.request);
    for (const call of mcpCalls(args.payload)) {
      const code = errores.get(call.id);
      dataset.writeDataPoint({
        blobs: [
          "mcp",
          call.method,
          call.tool,
          call.collection,
          call.cliente,
          call.clienteVersion,
          code === undefined ? "ok" : "error",
          code === undefined ? null : String(code),
          call.protocolo,
          args.visitante,
          country,
          null,
        ],
        doubles: [1],
        indexes: [`mcp:${call.cliente ?? "desconocido"}`.slice(0, MAX)],
      });
    }
  } catch {
    // Telemetría best-effort: si falla, se pierde el dato y nada más.
  }
}

/** Escribe un evento de la landing (`POST /api/beacon`). Nunca lanza. */
export function recordWeb(
  dataset: AnalyticsDataset | undefined,
  args: { request: Request; evento: string; pagina: string | null; visitante: string },
): void {
  if (!dataset) return;
  try {
    dataset.writeDataPoint({
      blobs: [
        "web",
        txt(args.evento),
        null,
        null,
        null,
        null,
        "ok",
        null,
        null,
        args.visitante,
        pais(args.request),
        txt(args.pagina),
      ],
      doubles: [1],
      indexes: [`web:${args.evento}`.slice(0, MAX)],
    });
  } catch {
    // Ídem recordMcp.
  }
}
