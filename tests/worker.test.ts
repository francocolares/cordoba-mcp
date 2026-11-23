import { beforeEach, describe, expect, it } from "vitest";
import { resetDataCache } from "../apps/worker/src/data.js";
import worker, { type Env } from "../apps/worker/src/index.js";
import { MAX_BATCH_REQUESTS, MAX_MCP_BODY_BYTES } from "../apps/worker/src/limits.js";
import { emptyR2, r2FromDataDir } from "./helpers.js";

/** El binding de assets, simulado: devolvemos un marcador para ver que delega. */
const assets = {
  fetch: async (request: Request) =>
    new Response(`assets:${new URL(request.url).pathname}`, {
      headers: { "content-type": "text/html" },
    }),
};

/** Los datos salen de R2; el doble los sirve desde data/ con el manifest real. */
const bucket = r2FromDataDir();
const env: Env = { ASSETS: assets, DATA: bucket };

const EVENTS = (bucket.files.get("eventos/records.jsonl") ?? "").trim().split("\n");
const PHARMACIES = (bucket.files.get("farmacias_turno/records.jsonl") ?? "")
  .trim()
  .split("\n")
  .filter(Boolean);
const TURNO_CALENDARS = JSON.parse(bucket.files.get("farmacias_turno/turnos.json") ?? "{}")
  .calendars as unknown[];

// El módulo de datos cachea el manifest 60s en el isolate: cada test arranca limpio.
beforeEach(() => resetDataCache());

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
  it("declara que los datos salen de R2, con la fecha del manifest", async () => {
    const body = (await (await call("/health")).json()) as {
      data_source: { kind: string; manifest_generated_at: string | null; error: string | null };
    };
    expect(body.data_source).toMatchObject({ kind: "r2", error: null });
    expect(body.data_source.manifest_generated_at).toBe(bucket.manifest.generated_at);
  });

  it("/health se arma iterando el catálogo", async () => {
    const res = await call("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      collections: { id: string; available: boolean; records?: number; data_as_of?: string }[];
    };
    expect(body.ok).toBe(true);
    expect(body.collections.map((c) => c.id)).toEqual([
      "eventos",
      "farmacias_turno",
      "exportadores",
    ]);

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
    expect(JSON.parse(lines[0]!).id).toBe(JSON.parse(EVENTS[0] ?? "{}").id);
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
      "exportadores",
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

describe("los datos vienen de R2", () => {
  const sinDatos: Env = { ASSETS: assets, DATA: emptyR2() };

  it("lee el manifest una vez y los objetos que declara", async () => {
    const limpio = r2FromDataDir();
    await worker.fetch(new Request("https://agenda.test/health"), {
      ASSETS: assets,
      DATA: limpio,
    });
    expect(limpio.reads[0]).toBe("manifest.json");
    expect(limpio.reads).toContain("eventos/records.jsonl");
    expect(limpio.reads).toContain("farmacias_turno/turnos.json");

    // Segundo request dentro del TTL: no vuelve a tocar el bucket.
    const antes = limpio.reads.length;
    await worker.fetch(new Request("https://agenda.test/health"), {
      ASSETS: assets,
      DATA: limpio,
    });
    expect(limpio.reads).toHaveLength(antes);
  });

  it("sin manifest las colecciones quedan no disponibles, y /health lo dice", async () => {
    const body = (await (
      await worker.fetch(new Request("https://agenda.test/health"), sinDatos)
    ).json()) as {
      ok: boolean;
      data_source: { error: string | null };
      collections: { available: boolean }[];
    };
    // El server está sano; lo que falta son los datos, y se reporta como tal.
    expect(body.ok).toBe(true);
    expect(body.data_source.error).toContain("manifest.json");
    expect(body.collections.every((c) => !c.available)).toBe(true);
  });

  it("sin datos, search contesta source_unavailable en vez de colgarse", async () => {
    const res = await worker.fetch(
      new Request("https://agenda.test/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "search", arguments: { collection: "eventos" } },
        }),
      }),
      sinDatos,
    );
    const json = (await res.json()) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(json.result.isError).toBe(true);
    expect(JSON.parse(json.result.content[0]!.text).error.code).toBe("source_unavailable");
  });

  it("sin datos, las rutas /api devuelven 503 y no 200 vacío", async () => {
    const res = await worker.fetch(new Request("https://agenda.test/api/eventos.jsonl"), sinDatos);
    expect(res.status).toBe(503);
  });

  it("sin el binding de R2 no explota: lo reporta en /health", async () => {
    const body = (await (
      await worker.fetch(new Request("https://agenda.test/health"), { ASSETS: assets })
    ).json()) as { data_source: { error: string | null } };
    expect(body.data_source.error).toContain("DATA");
  });
});

describe("límites contra el abuso", () => {
  it("un batch más largo que el tope se rechaza sin ejecutar nada", async () => {
    const batch = Array.from({ length: MAX_BATCH_REQUESTS + 1 }, (_, i) => ({
      jsonrpc: "2.0",
      id: i,
      method: "tools/call",
      params: { name: "search", arguments: { collection: "eventos" } },
    }));
    const res = await call("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(batch),
    });
    expect(res.status).toBe(413);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { error: { code: number; message: string } };
    expect(body.error.code).toBe(-32600);
    expect(body.error.message).toContain(String(MAX_BATCH_REQUESTS));
  });

  it("un batch dentro del tope sigue pasando", async () => {
    const batch = Array.from({ length: MAX_BATCH_REQUESTS }, (_, i) => ({
      jsonrpc: "2.0",
      id: i,
      method: "ping",
    }));
    const { res, json } = (await rpc(batch)) as { res: Response; json: { id: number }[] };
    expect(res.status).toBe(200);
    expect(json).toHaveLength(MAX_BATCH_REQUESTS);
  });

  it("un body gigante se corta por content-length, sin leerlo", async () => {
    const res = await call("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(MAX_MCP_BODY_BYTES + 1),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain(
      String(MAX_MCP_BODY_BYTES),
    );
  });

  it("un body gigante sin content-length también se corta", async () => {
    const relleno = "x".repeat(MAX_MCP_BODY_BYTES + 1);
    const res = await call("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { relleno } }),
    });
    expect(res.status).toBe(413);
  });

  const limitado = (permitidos: number) => {
    const keys: string[] = [];
    const env: Env = {
      ASSETS: assets,
      DATA: bucket,
      RATE_LIMIT: {
        limit: async ({ key }) => {
          keys.push(key);
          return { success: keys.length <= permitidos };
        },
      },
    };
    return { env, keys };
  };

  it("pasado el tope por IP devuelve 429 con retry-after", async () => {
    const { env: acotado } = limitado(1);
    const pedido = () =>
      worker.fetch(
        new Request("https://agenda.test/health", { headers: { "cf-connecting-ip": "1.2.3.4" } }),
        acotado,
      );

    expect((await pedido()).status).toBe(200);
    const cortado = await pedido();
    expect(cortado.status).toBe(429);
    expect(cortado.headers.get("retry-after")).toBe("60");
    expect(cortado.headers.get("cache-control")).toBe("no-store");
    expect(cortado.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("cuenta por IP, también en /mcp, /api y el beacon", async () => {
    const { env: acotado, keys } = limitado(99);
    const rutas = ["/health", "/api/eventos.jsonl", "/mcp", "/api/beacon"];
    for (const ruta of rutas) {
      await worker.fetch(
        new Request(`https://agenda.test${ruta}`, {
          method: ruta === "/health" || ruta.endsWith(".jsonl") ? "GET" : "POST",
          headers: { "cf-connecting-ip": "9.9.9.9", "content-type": "application/json" },
          ...(ruta === "/health" || ruta.endsWith(".jsonl")
            ? {}
            : { body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) }),
        }),
        acotado,
      );
    }
    expect(keys).toEqual(["9.9.9.9", "9.9.9.9", "9.9.9.9", "9.9.9.9"]);
  });

  it("los assets estáticos no gastan cupo", async () => {
    const { env: acotado, keys } = limitado(0);
    const res = await worker.fetch(new Request("https://agenda.test/index.html"), acotado);
    expect(res.status).toBe(200);
    expect(keys).toEqual([]);
  });

  it("el preflight de CORS tampoco gasta cupo", async () => {
    const { env: acotado, keys } = limitado(0);
    const res = await worker.fetch(
      new Request("https://agenda.test/mcp", { method: "OPTIONS" }),
      acotado,
    );
    expect(res.status).toBe(204);
    expect(keys).toEqual([]);
  });

  it("sin el binding el Worker atiende igual", async () => {
    const res = await worker.fetch(new Request("https://agenda.test/health"), {
      ASSETS: assets,
      DATA: bucket,
    });
    expect(res.status).toBe(200);
  });
});
