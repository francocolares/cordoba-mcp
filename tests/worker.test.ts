import { describe, expect, it } from "vitest";
import { EVENTS, PHARMACIES, TURNO_CALENDARS } from "../apps/worker/src/data.generated.js";
import worker, { type Env } from "../apps/worker/src/index.js";

/** El binding de assets, simulado: devolvemos un marcador para ver que delega. */
const env: Env = {
  ASSETS: {
    fetch: async (request: Request) =>
      new Response(`assets:${new URL(request.url).pathname}`, {
        headers: { "content-type": "text/html" },
      }),
  },
};

const call = (path: string, init?: RequestInit) =>
  worker.fetch(new Request(`https://agenda.test${path}`, init), env);

const rpc = async (body: unknown) => {
  const res = await call("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { res, json: res.status === 202 ? null : await res.json() };
};

describe("rutas del Worker", () => {
  it("/health informa los eventos embebidos", async () => {
    const res = await call("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, events: EVENTS.length });
    expect(body["data_as_of"]).toBeTruthy();
  });

  it("/health informa las dos fuentes embebidas", async () => {
    const body = (await (await call("/health")).json()) as {
      sources: { agenda: { events: number }; farmacias: { pharmacies: number } | null };
    };
    expect(body.sources.agenda.events).toBe(EVENTS.length);
    if (PHARMACIES.length > 0) {
      expect(body.sources.farmacias?.pharmacies).toBe(PHARMACIES.length);
    } else {
      expect(body.sources.farmacias).toBeNull();
    }
  });

  it("sirve las farmacias y el turnero como datos crudos", async () => {
    const jsonl = await call("/api/farmacias.jsonl");
    expect(jsonl.headers.get("content-type")).toContain("application/x-ndjson");
    const lines = (await jsonl.text()).trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(PHARMACIES.length);

    const turnos = (await (await call("/api/farmacias/turnos.json")).json()) as {
      calendars: unknown[];
    };
    expect(turnos.calendars).toHaveLength(TURNO_CALENDARS.length);

    expect((await call("/api/farmacias/status.json")).status).toBe(200);
  });

  it("delega al binding de assets lo que no es /mcp ni /api", async () => {
    const res = await call("/");
    expect(await res.text()).toBe("assets:/");
    expect(await (await call("/no-existe")).text()).toBe("assets:/no-existe");
  });

  it("expone los datos crudos", async () => {
    const res = await call("/api/events.jsonl");
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const lines = (await res.text()).trim().split("\n");
    expect(lines).toHaveLength(EVENTS.length);
    expect(JSON.parse(lines[0]!).id).toBe(EVENTS[0]?.id);
  });

  it("responde el preflight de CORS", async () => {
    const res = await call("/mcp", { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("GET /mcp avisa que sólo acepta POST", async () => {
    const res = await call("/mcp");
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toContain("POST");
  });

  it("DELETE /mcp cierra sin estado", async () => {
    expect((await call("/mcp", { method: "DELETE" })).status).toBe(204);
  });
});

describe("JSON-RPC del MCP", () => {
  it("initialize negocia el protocolo y anuncia capabilities", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {} },
    });
    expect(json).toMatchObject({
      id: 1,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "cordoba-mcp" },
      },
    });
  });

  it("las notificaciones no llevan respuesta (202)", async () => {
    const { res, json } = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).toBe(202);
    expect(json).toBeNull();
  });

  it("tools/list devuelve las tools de las dos fuentes con JSON Schema", async () => {
    const { json } = (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })) as {
      json: { result: { tools: { name: string; inputSchema: Record<string, unknown> }[] } };
    };
    const tools = json.result.tools;
    expect(tools.map((t) => t.name)).toEqual([
      "search_events",
      "events_on",
      "this_weekend",
      "get_event",
      "list_categories",
      "source_status",
      "pharmacies_on_duty",
      "pharmacies_near",
      "duty_turno_on",
      "find_pharmacy",
      "get_pharmacy",
    ]);
    const search = tools[0]!.inputSchema as { properties: Record<string, unknown> };
    expect(Object.keys(search.properties)).toContain("free_only");
  });

  it("tools/call devuelve el envelope con la fuente", async () => {
    const { json } = (await rpc({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "this_weekend", arguments: { free_only: true } },
    })) as { json: { result: { content: { text: string }[] } } };
    const payload = JSON.parse(json.result.content[0]!.text);
    expect(payload.source).toContain("Municipalidad de Córdoba");
    expect(payload.timezone).toBe("America/Argentina/Cordoba");
    expect(payload.range.from).toMatch(/T18:00:00-03:00$/);
    expect(Array.isArray(payload.events)).toBe(true);
  });

  it("get_event inexistente marca isError sin romper el protocolo", async () => {
    const { json } = (await rpc({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "get_event", arguments: { id: "nope" } },
    })) as { json: { result: { isError: boolean } } };
    expect(json.result.isError).toBe(true);
  });

  it("valida los argumentos con zod", async () => {
    const { json } = (await rpc({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "search_events", arguments: { limit: 999 } },
    })) as { json: { error: { code: number } } };
    expect(json.error.code).toBe(-32602);
  });

  it("rechaza tools y métodos desconocidos", async () => {
    const unknownTool = (await rpc({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "drop_database" },
    })) as { json: { error: { code: number } } };
    expect(unknownTool.json.error.code).toBe(-32602);

    const unknownMethod = (await rpc({ jsonrpc: "2.0", id: 7, method: "nope/x" })) as {
      json: { error: { code: number } };
    };
    expect(unknownMethod.json.error.code).toBe(-32601);
  });

  it("lee el resource de status y lista los disponibles", async () => {
    const list = (await rpc({ jsonrpc: "2.0", id: 8, method: "resources/list" })) as {
      json: { result: { resources: { uri: string }[] } };
    };
    expect(list.json.result.resources[0]?.uri).toBe("agenda://status");

    const read = (await rpc({
      jsonrpc: "2.0",
      id: 9,
      method: "resources/read",
      params: { uri: "agenda://status" },
    })) as { json: { result: { contents: { text: string }[] } } };
    const status = JSON.parse(read.json.result.contents[0]!.text);
    expect(status.agenda.status.validation.status).toBeTruthy();
    expect(status.farmacias).toBeTruthy();

    const missing = (await rpc({
      jsonrpc: "2.0",
      id: 10,
      method: "resources/read",
      params: { uri: "agenda://otro" },
    })) as { json: { error: { code: number } } };
    expect(missing.json.error.code).toBe(-32602);
  });

  it("soporta batch y descarta las notificaciones", async () => {
    const { json } = (await rpc([
      { jsonrpc: "2.0", id: 11, method: "ping" },
      { jsonrpc: "2.0", method: "notifications/cancelled" },
      { jsonrpc: "2.0", id: 12, method: "tools/list" },
    ])) as { json: { id: number }[] };
    expect(json.map((r) => r.id)).toEqual([11, 12]);
  });

  it("body inválido => 400 con error de parseo", async () => {
    const res = await call("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "no soy json",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: number } }).error.code).toBe(-32700);
  });
});
