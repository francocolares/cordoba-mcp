/**
 * Worker de Cloudflare: sirve la landing estática de Astro y expone el MCP en
 * /mcp. Los datos salen de R2 (ver data.ts), con cache en el isolate y en la
 * caché del edge: un dato nuevo no necesita un deploy del código.
 *
 * Las rutas de datos (`/health`, `/api/*`) se arman iterando el catálogo de
 * core: una colección nueva aparece sola, sin tocar este archivo.
 *
 * `/api/beacon` es la excepción: no lee datos, recibe los eventos de la
 * landing y los escribe en Analytics Engine junto con los del MCP (analytics.ts).
 */
import { COLLECTIONS, findCollection, isWebEvent, type Snapshot } from "@cordoba/core/web";
import { type AnalyticsDataset, recordMcp, recordWeb, visitorId } from "./analytics.js";
import { type DataBucket, loadData } from "./data.js";
import {
  containsInitialize,
  handleMcpPayload,
  newSessionId,
  PROTOCOL_VERSION,
  SERVER_INFO,
} from "./mcp.js";

export interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  /** Bucket con los datasets. Lo llena scripts/sync-r2.mjs. */
  DATA?: DataBucket;
  /**
   * Dataset de Analytics Engine (ver analytics.ts). Opcional: sin el binding
   * el Worker funciona igual, sólo no mide.
   */
  ANALYTICS?: AnalyticsDataset;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers":
    "content-type, mcp-protocol-version, mcp-session-id, last-event-id, authorization",
  // Sin esto un cliente en el browser no puede leer el id de sesión que emitimos.
  "access-control-expose-headers": "mcp-session-id",
  "access-control-max-age": "86400",
};

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body, null, 1), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
      ...CORS,
      ...(init.headers ?? {}),
    },
  });

const toJsonl = (rows: unknown[]): string =>
  `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;

const ndjson = (rows: unknown[]) =>
  new Response(toJsonl(rows), {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "public, max-age=300",
      ...CORS,
    },
  });

async function handleMcp(request: Request, snapshot: Snapshot, env: Env): Promise<Response> {
  if (request.method === "DELETE") {
    // Cierre de sesión: no hay registro de sesiones, así que no hay nada que limpiar.
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method === "GET") {
    // No hay canal server->client: la superficie de tools está congelada, así
    // que no hay notificaciones que entregar. La spec contempla este 405 y el
    // SDK lo trata como caso esperado.
    return json(
      {
        error: "Este endpoint acepta POST. No hay stream SSE: la lista de tools no cambia.",
        server: SERVER_INFO,
        protocolVersion: PROTOCOL_VERSION,
      },
      { status: 405, headers: { allow: "POST, DELETE, OPTIONS" } },
    );
  }
  if (request.method !== "POST") {
    return json({ error: "Método no permitido" }, { status: 405 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON inválido" } },
      { status: 400 },
    );
  }

  const response = handleMcpPayload(snapshot, payload);
  // Un evento por request JSON-RPC: de acá salen sesiones por día, clientes,
  // tools más usadas y qué consultas fallan. Se escribe antes de salir por
  // cualquiera de las dos ramas (202 incluido: una notificación también cuenta).
  if (env.ANALYTICS) {
    recordMcp(env.ANALYTICS, {
      request,
      payload,
      response,
      visitante: await visitorId(request),
    });
  }
  if (response === null) return new Response(null, { status: 202, headers: CORS });
  const sessionHeaders: Record<string, string> = containsInitialize(payload)
    ? { "mcp-session-id": newSessionId() }
    : {};
  return json(response, { headers: { "cache-control": "no-store", ...sessionHeaders } });
}

/** `/api/{collection}.jsonl`, `/api/{collection}/status.json` y los extras. */
function handleApi(path: string, snapshot: Snapshot): Response | null {
  const rest = path.slice("/api/".length);
  if (rest === "") return null;

  const known = (id: string) => COLLECTIONS.some((c) => c.descriptor.id === id);
  const jsonlMatch = /^([a-z_]+)\.jsonl$/.exec(rest);
  if (jsonlMatch) {
    const id = jsonlMatch[1] as string;
    if (!known(id)) return null;
    const store = snapshot[id] ?? null;
    if (store === null)
      return json({ error: `La colección ${id} no está disponible` }, { status: 503 });
    return ndjson(findCollection(id).dump(store).jsonl);
  }

  const parts = rest.split("/");
  if (parts.length !== 2) return null;
  const [id, file] = parts as [string, string];
  if (!known(id)) return null;
  const store = snapshot[id] ?? null;
  if (store === null) {
    return json({ error: `La colección ${id} no está disponible` }, { status: 503 });
  }
  const extra = findCollection(id).dump(store).extras?.[file];
  return extra === undefined ? null : json(extra);
}

/**
 * Rutas anteriores al catálogo genérico. Se mantienen porque son URLs públicas
 * y no sabemos quién las consume fuera del MCP.
 */
const LEGACY_API: Record<string, string> = {
  "/api/events.jsonl": "/api/eventos.jsonl",
  "/api/status.json": "/api/eventos/status.json",
  "/api/farmacias.jsonl": "/api/farmacias_turno.jsonl",
  "/api/farmacias/status.json": "/api/farmacias_turno/status.json",
  "/api/farmacias/turnos.json": "/api/farmacias_turno/turnos.json",
};

/** Ruta del beacon de la landing. La conoce también `apps/web` (Layout.astro). */
const BEACON_PATH = "/api/beacon";

/**
 * Eventos de la landing: `navigator.sendBeacon` manda un JSON chico
 * `{ evento, pagina }`. Es un endpoint público, así que se valida el nombre
 * contra el catálogo de core y se corta el body por tamaño; cualquier otra
 * cosa se descarta sin ruido (204) para no darle señal a quien pruebe.
 */
async function handleBeacon(request: Request, env: Env): Promise<Response> {
  const vacio = new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store", ...CORS },
  });
  if (request.method !== "POST") {
    return json(
      { error: "Este endpoint acepta POST" },
      { status: 405, headers: { allow: "POST" } },
    );
  }
  if (Number(request.headers.get("content-length") ?? 0) > 512) return vacio;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (!isWebEvent(body["evento"])) return vacio;
    const pagina = typeof body["pagina"] === "string" ? body["pagina"] : null;
    recordWeb(env.ANALYTICS, {
      request,
      evento: body["evento"],
      pagina,
      visitante: await visitorId(request),
    });
  } catch {
    // Body inválido: no es un error que valga la pena reportar al cliente.
  }
  return vacio;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === BEACON_PATH) return handleBeacon(request, env);

    const needsData =
      url.pathname === "/mcp" ||
      url.pathname === "/mcp/" ||
      url.pathname === "/health" ||
      url.pathname.startsWith("/api/") ||
      url.pathname in LEGACY_API;
    if (!needsData) return env.ASSETS.fetch(request);

    const data = await loadData(env.DATA);

    if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
      return handleMcp(request, data.snapshot, env);
    }

    if (url.pathname === "/health") {
      return json({
        ok: true,
        server: SERVER_INFO,
        data_source: {
          kind: "r2",
          manifest_generated_at: data.manifest?.generated_at ?? null,
          error: data.error,
        },
        collections: COLLECTIONS.map((collection) => {
          const id = collection.descriptor.id;
          const store = data.snapshot[id] ?? null;
          return {
            id,
            title: collection.descriptor.title,
            available: store !== null,
            ...(store === null ? {} : collection.status(store)),
          };
        }),
      });
    }

    const path = LEGACY_API[url.pathname] ?? url.pathname;
    const response = handleApi(path, data.snapshot);
    if (response) return response;

    return env.ASSETS.fetch(request);
  },
};
