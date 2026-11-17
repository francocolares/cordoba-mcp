/**
 * Worker de Cloudflare: sirve la landing estática de Astro y expone el MCP en
 * /mcp. Los datasets viajan embebidos en el bundle (ver scripts/embed-data.mjs),
 * así que no hay KV, D1 ni fetch externo en el camino crítico.
 *
 * Las rutas de datos (`/health`, `/api/*`) se arman iterando el catálogo de
 * core: una colección nueva aparece sola, sin tocar este archivo.
 */
import { COLLECTIONS, findCollection, type Snapshot } from "@cordoba/core/web";
import {
  DATA_AS_OF,
  EMBEDDED_AT,
  EVENTS,
  FARMACIAS_DATA_AS_OF,
  FARMACIAS_STATUS,
  PHARMACIES,
  STATUS,
  TURNO_CALENDARS,
} from "./data.generated.js";
import {
  containsInitialize,
  handleMcpPayload,
  newSessionId,
  PROTOCOL_VERSION,
  SERVER_INFO,
} from "./mcp.js";

export interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

/** Un store por colección. `null` = la fuente no vino en este deploy. */
const snapshot: Snapshot = {
  eventos: { events: EVENTS, status: STATUS, data_as_of: DATA_AS_OF },
  farmacias_turno:
    PHARMACIES.length === 0
      ? null
      : {
          pharmacies: PHARMACIES,
          calendars: TURNO_CALENDARS,
          status: FARMACIAS_STATUS,
          data_as_of: FARMACIAS_DATA_AS_OF,
        },
};

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

/** Store de una colección, o null si no está cargada. */
function storeOf(id: string): unknown {
  return snapshot[id] ?? null;
}

async function handleMcp(request: Request): Promise<Response> {
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
  if (response === null) return new Response(null, { status: 202, headers: CORS });
  const sessionHeaders: Record<string, string> = containsInitialize(payload)
    ? { "mcp-session-id": newSessionId() }
    : {};
  return json(response, { headers: { "cache-control": "no-store", ...sessionHeaders } });
}

/** `/api/{collection}.jsonl`, `/api/{collection}/status.json` y los extras. */
function handleApi(path: string): Response | null {
  const rest = path.slice("/api/".length);
  if (rest === "") return null;

  const jsonlMatch = /^([a-z_]+)\.jsonl$/.exec(rest);
  if (jsonlMatch) {
    const id = jsonlMatch[1] as string;
    if (!COLLECTIONS.some((c) => c.descriptor.id === id)) return null;
    const store = storeOf(id);
    return ndjson(store === null ? [] : findCollection(id).dump(store).jsonl);
  }

  const parts = rest.split("/");
  if (parts.length !== 2) return null;
  const [id, file] = parts as [string, string];
  if (!COLLECTIONS.some((c) => c.descriptor.id === id)) return null;
  const collection = findCollection(id);
  const store = storeOf(id);
  if (store === null) return json({ error: `La colección ${id} no está cargada` }, { status: 404 });
  if (file === "status.json") return json(collection.status(store));
  const extra = collection.dump(store).extras?.[file];
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
      return handleMcp(request);
    }

    if (url.pathname === "/health") {
      return json({
        ok: true,
        server: SERVER_INFO,
        embedded_at: EMBEDDED_AT,
        collections: COLLECTIONS.map((collection) => {
          const id = collection.descriptor.id;
          const store = storeOf(id);
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
    if (path.startsWith("/api/")) {
      const response = handleApi(path);
      if (response) return response;
    }

    return env.ASSETS.fetch(request);
  },
};
