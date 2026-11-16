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
import { handleMcpPayload, PROTOCOL_VERSION, SERVER_INFO } from "./mcp.js";

export interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
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
    "content-type, mcp-protocol-version, mcp-session-id, authorization",
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

async function handleMcp(request: Request): Promise<Response> {
  if (request.method === "DELETE") {
    // Cierre de sesión: el server es stateless, así que no hay nada que limpiar.
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method === "GET") {
    return json(
      {
        error: "Este endpoint acepta sólo POST (streamable HTTP sin SSE).",
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
  return json(response, { headers: { "cache-control": "no-store" } });
}

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
