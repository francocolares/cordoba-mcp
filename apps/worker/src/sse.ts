/**
 * Canal server->client del streamable HTTP: el `GET /mcp` con SSE, por donde
 * sale `notifications/tools/list_changed`.
 *
 * Todo lo de acá salió de medirlo contra Cloudflare, no de la spec:
 *
 *  1. NI UN `await` al writer antes de devolver la `Response`. Escribir bloquea
 *     por backpressure mientras nadie lee el readable, y workerd mata el request
 *     con "your Worker's code had hung and would never generate a response".
 *
 *  2. El stream TIENE que tener TTL. Son dos razones:
 *     - `request.signal` no dispara cuando el cliente se va (medido en
 *       producción), y escribir a un socket muerto no falla: sin TTL el loop de
 *       keepalive queda girando para siempre.
 *     - Un deploy de Cloudflare NO corta las conexiones abiertas: el isolate
 *       viejo sigue atendiendo su stream indefinidamente. El cierre por TTL es
 *       lo único que fuerza la reconexión, y la reconexión es la que entrega la
 *       notificación. O sea: el TTL es el mecanismo, no una mitigación, y marca
 *       la latencia máxima con la que un cliente se entera de un cambio.
 *
 *  3. El keepalive necesita `id:` Y `data:` no vacía. Un bloque con sólo `id:`
 *     (o un comentario `: ...`) no despacha evento —la spec SSE no despacha con
 *     el data buffer vacío—, así que el cliente no refrescaría su resumption
 *     token. Con `event: keepalive` el cliente registra el id y descarta el
 *     payload, porque sólo procesa como mensaje los de tipo `message`.
 *
 *  4. Hace falta mirar el `Last-Event-ID`, no sólo el session id: el cliente
 *     nunca rota su `Mcp-Session-Id` (el SDK sólo lo lee de la respuesta del
 *     POST), así que con el session id solo re-notificaríamos en cada
 *     reconexión, para siempre.
 */
import { revisionOf, TOOLS_REVISION } from "./mcp.js";

/** Cada cuánto le decimos al cliente que reintente si se le cae el stream. */
const RETRY_MS = 2_000;

/** Tope del keepalive. Con TTLs cortos se usa la mitad del TTL. */
const MAX_KEEPALIVE_MS = 15_000;

export const DEFAULT_TTL_S = 60;

export interface SseOptions {
  /** Vida del stream en segundos: también es la latencia máxima del aviso. */
  ttlS?: number | undefined;
}

/** Lee el TTL de la var de entorno, con default y cota de sanidad. */
export function resolveTtlS(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TTL_S;
  return Math.min(Math.max(Math.round(parsed), 1), 600);
}

const NOTIFICATIONS = [
  { jsonrpc: "2.0", method: "notifications/tools/list_changed" },
  { jsonrpc: "2.0", method: "notifications/resources/list_changed" },
] as const;

/**
 * Decide si este cliente está viendo una lista de tools vieja. Stateless: todo
 * sale de los headers que trae el propio request.
 */
export function needsListChanged(request: Request, revision = TOOLS_REVISION): boolean {
  const sessionRevision = revisionOf(request.headers.get("mcp-session-id"));
  // Sin sesión no sabemos de qué revisión viene: recién hizo el handshake con
  // esta misma, así que no hay nada que avisarle.
  if (sessionRevision === null || sessionRevision === revision) return false;
  // Y si el último evento que recibió ya era de esta revisión, ya le avisamos.
  const lastSeen = (request.headers.get("last-event-id") ?? "").split(":")[0] ?? "";
  return lastSeen !== revision;
}

export function sseResponse(
  request: Request,
  extraHeaders: Record<string, string> = {},
  options: SseOptions = {},
): Response {
  const ttlMs = (options.ttlS ?? DEFAULT_TTL_S) * 1000;
  const keepaliveMs = Math.max(250, Math.min(MAX_KEEPALIVE_MS, Math.floor(ttlMs / 2)));
  const stale = needsListChanged(request);

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const openedAt = Date.now();
  let seq = 0;
  let closed = false;

  const send = (frame: string) => writer.write(encoder.encode(frame));
  const notify = (payload: unknown) =>
    send(`id: ${TOOLS_REVISION}:n${++seq}\nevent: message\ndata: ${JSON.stringify(payload)}\n\n`);

  // Por si algún día el runtime sí avisa; hoy no dispara, y el TTL es el que cierra.
  request.signal?.addEventListener("abort", () => {
    closed = true;
  });

  // Tarea desprendida: ver el punto 1 del comentario de arriba.
  void (async () => {
    try {
      await send(`retry: ${RETRY_MS}\n\n`);
      if (stale) for (const payload of NOTIFICATIONS) await notify(payload);
      while (!closed) {
        await new Promise((resolve) => setTimeout(resolve, keepaliveMs));
        if (closed) break;
        const ageMs = Date.now() - openedAt;
        if (ageMs >= ttlMs) break;
        await send(
          `id: ${TOOLS_REVISION}:ka${++seq}\nevent: keepalive\ndata: ${Math.round(ageMs / 1000)}\n\n`,
        );
      }
    } catch {
      // El cliente cortó, o el socket murió: no hay nada que reportar.
    } finally {
      await writer.close().catch(() => {});
    }
  })();

  return new Response(readable, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}
