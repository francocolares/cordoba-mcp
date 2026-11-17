/**
 * Worker de Cloudflare: sirve la landing estática de Astro y expone el MCP en
 * /mcp. Los eventos viajan embebidos en el bundle (ver scripts/embed-data.mjs),
 * así que no hay KV, D1 ni fetch externo en el camino crítico.
 */
import type { Snapshot } from "@cordoba/core/web";
import { FARMACIAS_SOURCE_NAME, SOURCE_NAME, TURNO_WINDOW_INFO } from "@cordoba/core/web";
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
  TOOLS_REVISION,
} from "./mcp.js";
import { resolveTtlS, sseResponse } from "./sse.js";

export interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  /** Vida del stream SSE en segundos; también la latencia máxima del aviso. */
  MCP_SSE_TTL_S?: string | undefined;
}

const snapshot: Snapshot = {
  agenda: { events: EVENTS, status: STATUS, data_as_of: DATA_AS_OF },
  // Sin farmacias embebidas el dataset queda en null y los tools lo reportan.
  farmacias:
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

async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (request.method === "DELETE") {
    // Cierre de sesión: no hay registro de sesiones, así que no hay nada que
    // limpiar. El stream SSE del cliente muere solo por TTL.
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method === "GET") {
    // Canal server->client. Sólo con Accept: text/event-stream; el 405 es la
    // forma que la spec le da al server para decir "acá no hay SSE", y el SDK
    // lo trata como caso esperado.
    if ((request.headers.get("accept") ?? "").includes("text/event-stream")) {
      return sseResponse(request, CORS, { ttlS: resolveTtlS(env.MCP_SSE_TTL_S) });
    }
    return json(
      {
        error: "Este endpoint acepta POST, o GET con Accept: text/event-stream.",
        server: SERVER_INFO,
        protocolVersion: PROTOCOL_VERSION,
      },
      { status: 405, headers: { allow: "POST, GET, DELETE, OPTIONS" } },
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
  // El id de sesión se emite sólo en el initialize, y lleva adentro la revisión
  // de tools: es lo que después permite detectar un cliente con la lista vieja.
  const sessionHeaders: Record<string, string> = containsInitialize(payload)
    ? { "mcp-session-id": newSessionId() }
    : {};
  return json(response, { headers: { "cache-control": "no-store", ...sessionHeaders } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
      return handleMcp(request, env);
    }

    if (url.pathname === "/health") {
      return json({
        ok: true,
        server: SERVER_INFO,
        tools_revision: TOOLS_REVISION,
        embedded_at: EMBEDDED_AT,
        sources: {
          agenda: {
            source: SOURCE_NAME,
            events: snapshot.agenda.events.length,
            active: snapshot.agenda.events.filter((e) => e.active).length,
            data_as_of: snapshot.agenda.data_as_of,
            validation: snapshot.agenda.status?.validation?.status ?? null,
          },
          farmacias: snapshot.farmacias
            ? {
                source: FARMACIAS_SOURCE_NAME,
                pharmacies: snapshot.farmacias.pharmacies.length,
                active: snapshot.farmacias.pharmacies.filter((p) => p.active).length,
                geocoded: snapshot.farmacias.pharmacies.filter((p) => p.lat !== null).length,
                years: snapshot.farmacias.calendars.map((c) => c.year),
                data_as_of: snapshot.farmacias.data_as_of,
                validation: snapshot.farmacias.status?.validation?.status ?? null,
                turno_window: TURNO_WINDOW_INFO,
              }
            : null,
        },
        // Compatibilidad con la versión anterior de /health.
        source: SOURCE_NAME,
        events: snapshot.agenda.events.length,
        active: snapshot.agenda.events.filter((e) => e.active).length,
        data_as_of: snapshot.agenda.data_as_of,
        validation: snapshot.agenda.status?.validation?.status ?? null,
      });
    }

    // Los datos crudos, para quien quiera consumirlos sin MCP.
    if (url.pathname === "/api/events.jsonl") {
      return ndjson(snapshot.agenda.events);
    }
    if (url.pathname === "/api/status.json") {
      return json(snapshot.agenda.status ?? { error: "sin status" });
    }
    if (url.pathname === "/api/farmacias.jsonl") {
      return ndjson(snapshot.farmacias?.pharmacies ?? []);
    }
    if (url.pathname === "/api/farmacias/turnos.json") {
      return json({ calendars: snapshot.farmacias?.calendars ?? [] });
    }
    if (url.pathname === "/api/farmacias/status.json") {
      return json(snapshot.farmacias?.status ?? { error: "sin status" });
    }

    return env.ASSETS.fetch(request);
  },
};
