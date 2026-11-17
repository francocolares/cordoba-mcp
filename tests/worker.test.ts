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
  it("/health se arma iterando el catálogo", async () => {
    const res = await call("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      collections: { id: string; available: boolean; records?: number; data_as_of?: string }[];
    };
    expect(body.ok).toBe(true);
    expect(body.collections.map((c) => c.id)).toEqual(["eventos", "farmacias_turno"]);

    const eventos = body.collections.find((c) => c.id === "eventos")!;
    expect(eventos.records).toBe(EVENTS.length);
    expect(eventos.data_as_of).toBeTruthy();

    const farmacias = body.collections.find((c) => c.id === "farmacias_turno")!;
    if (PHARMACIES.length > 0) expect(farmacias.records).toBe(PHARMACIES.length);
    else expect(farmacias.available).toBe(false);
  });

  it("sirve cada colección como datos crudos, por su id", async () => {
    const jsonl = await call("/api/farmacias_turno.jsonl");
    expect(jsonl.headers.get("content-type")).toContain("application/x-ndjson");
    const lines = (await jsonl.text()).trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(PHARMACIES.length);

    const turnos = (await (await call("/api/farmacias_turno/turnos.json")).json()) as {
      calendars: unknown[];
    };
    expect(turnos.calendars).toHaveLength(TURNO_CALENDARS.length);

    expect((await call("/api/farmacias_turno/status.json")).status).toBe(200);
  });

  it("mantiene las rutas anteriores como alias", async () => {
    for (const [viejo, esperado] of [
      ["/api/events.jsonl", "application/x-ndjson"],
      ["/api/farmacias.jsonl", "application/x-ndjson"],
      ["/api/status.json", "application/json"],
      ["/api/farmacias/status.json", "application/json"],
      ["/api/farmacias/turnos.json", "application/json"],
    ] as const) {
      const res = await call(viejo);
      expect(res.status, viejo).toBe(200);
      expect(res.headers.get("content-type"), viejo).toContain(esperado);
    }
  });

  it("delega al binding de assets lo que no es /mcp ni /api", async () => {
    const res = await call("/");
    expect(await res.text()).toBe("assets:/");
    expect(await (await call("/no-existe")).text()).toBe("assets:/no-existe");
  });

  it("expone los eventos crudos", async () => {
    const res = await call("/api/eventos.jsonl");
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

  it("GET /mcp avisa que sólo acepta POST, también pidiendo SSE", async () => {
    for (const init of [undefined, { headers: { accept: "text/event-stream" } }]) {
      const res = await call("/mcp", init);
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toContain("POST");
      expect(res.headers.get("allow")).not.toContain("GET");
    }
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
        serverInfo: { name: "cordoba-mcp", title: "Córdoba MCP" },
      },
    });
    const { result } = json as { result: { instructions: string } };
    // Viaja en el handshake y queda pegada a la sesión: no puede nombrar
    // fuentes concretas, o cada fuente nueva la dejaría mintiendo.
    expect(result.instructions).toContain("unificada y estandarizada");
    expect(result.instructions).toContain("list_collections");
    expect(result.instructions).not.toMatch(/Municipalidad|Colegio de Farmac/);
  });

  it("las notificaciones no llevan respuesta (202)", async () => {
    const { res, json } = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).toBe(202);
    expect(json).toBeNull();
  });

  it("tools/list devuelve las cuatro tools con JSON Schema", async () => {
    const { json } = (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })) as {
      json: { result: { tools: { name: string; inputSchema: Record<string, unknown> }[] } };
    };
    const tools = json.result.tools;
    expect(tools.map((t) => t.name)).toEqual([
      "list_collections",
      "search",
      "get",
      "source_status",
    ]);
    const search = tools[1]!.inputSchema as {
      properties: Record<string, Record<string, unknown>>;
      required: string[];
    };
    expect(Object.keys(search.properties)).toEqual(
      expect.arrayContaining(["collection", "query", "date", "near", "filters", "limit", "cursor"]),
    );
    expect(search.required).toEqual(["collection"]);
    // `filters` tiene que quedar abierto: es lo que permite que una colección
    // nueva traiga sus propios filtros sin republicar el schema.
    expect(search.properties["filters"]!["additionalProperties"]).not.toBe(false);
  });

  it("tools/call devuelve el envelope con la fuente y el catálogo", async () => {
    const { json } = (await rpc({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "search",
        arguments: { collection: "eventos", date: { from: "fin_de_semana" } },
      },
    })) as { json: { result: { content: { text: string }[] } } };
    const payload = JSON.parse(json.result.content[0]!.text);
    expect(payload.collection).toBe("eventos");
    expect(payload.sources[0].name).toContain("Municipalidad de Córdoba");
    expect(payload.timezone).toBe("America/Argentina/Cordoba");
    expect(payload.catalog_version).toEqual(expect.any(String));
    expect(payload.resolved.from).toMatch(/T18:00:00-03:00$/);
    expect(Array.isArray(payload.items)).toBe(true);
  });

  it("un id inexistente marca isError sin romper el protocolo", async () => {
    const { json } = (await rpc({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "get", arguments: { ids: ["eventos:turismo_muni:nope"] } },
    })) as { json: { result: { isError: boolean; content: { text: string }[] } } };
    expect(json.result.isError).toBe(true);
    expect(JSON.parse(json.result.content[0]!.text).error.code).toBe("not_found");
  });

  it("valida los argumentos con zod", async () => {
    const { json } = (await rpc({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "search", arguments: { collection: "eventos", limit: 999 } },
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

  it("expone un único resource de URI fija: el catálogo", async () => {
    const list = (await rpc({ jsonrpc: "2.0", id: 8, method: "resources/list" })) as {
      json: { result: { resources: { uri: string }[] } };
    };
    // La lista no crece con el catálogo: lo que crece es el contenido. Si
    // creciera la lista, volvería el problema de la caché de resources/list.
    expect(list.json.result.resources).toHaveLength(1);
    expect(list.json.result.resources[0]?.uri).toBe("cordoba://catalog");

    const read = (await rpc({
      jsonrpc: "2.0",
      id: 9,
      method: "resources/read",
      params: { uri: "cordoba://catalog" },
    })) as { json: { result: { contents: { text: string }[] } } };
    const catalog = JSON.parse(read.json.result.contents[0]!.text);
    expect(catalog.catalog_version).toEqual(expect.any(String));
    expect(catalog.collections.map((c: { id: string }) => c.id)).toEqual([
      "eventos",
      "farmacias_turno",
    ]);
    expect(catalog.collections[0].sources[0].name).toBeTruthy();

    const missing = (await rpc({
      jsonrpc: "2.0",
      id: 10,
      method: "resources/read",
      params: { uri: "cordoba://otro" },
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
