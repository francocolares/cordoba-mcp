import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mcpCalls, visitorId } from "../apps/worker/src/analytics.js";
import worker, { type Env } from "../apps/worker/src/index.js";
import { isWebEvent, WEB_EVENTS } from "../packages/core/src/analytics.js";
import { r2FromDataDir } from "./helpers.js";

interface Punto {
  blobs?: (string | null)[];
  doubles?: number[];
  indexes?: string[];
}

/** Doble del dataset de Analytics Engine: guarda los puntos en memoria. */
function dataset() {
  const puntos: Punto[] = [];
  return { puntos, writeDataPoint: (p: Punto) => void puntos.push(p) };
}

const assets = {
  fetch: async (request: Request) => new Response(`assets:${new URL(request.url).pathname}`),
};

const envCon = (analytics?: ReturnType<typeof dataset>): Env => ({
  ASSETS: assets,
  DATA: r2FromDataDir(),
  ...(analytics ? { ANALYTICS: analytics } : {}),
});

const post = (env: Env, path: string, body: unknown) =>
  worker.fetch(
    new Request(`https://agenda.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
  );

describe("vocabulario de eventos", () => {
  it("acepta los eventos del catálogo y las vías de contribución", () => {
    for (const evento of WEB_EVENTS) expect(isWebEvent(evento)).toBe(true);
    expect(isWebEvent("via_sponsor")).toBe(true);
    expect(isWebEvent("via_servicios")).toBe(true);
  });

  it("rechaza cualquier otro nombre", () => {
    for (const basura of ["", "VISITA", "visita; drop", "x".repeat(200), 42, null, "via_"]) {
      expect(isWebEvent(basura)).toBe(false);
    }
  });

  it("todo `data-evento` de la landing es un evento válido", () => {
    const archivos = globSync("apps/web/src/**/*.astro");
    expect(archivos.length).toBeGreaterThan(0);
    const usados = new Set<string>();
    for (const archivo of archivos) {
      const fuente = readFileSync(archivo, "utf8");
      for (const m of fuente.matchAll(/data-evento="([^"]+)"/g)) usados.add(m[1]!);
    }
    expect(usados.size).toBeGreaterThan(0);
    for (const evento of usados) expect(isWebEvent(evento), evento).toBe(true);
  });
});

describe("hash del visitante", () => {
  it("es estable dentro del día y cambia al día siguiente", async () => {
    const req = () =>
      new Request("https://agenda.test/mcp", {
        headers: { "cf-connecting-ip": "1.2.3.4", "user-agent": "claude" },
      });
    const hoy = new Date("2026-11-17T15:00:00Z");
    expect(await visitorId(req(), hoy)).toBe(await visitorId(req(), hoy));
    expect(await visitorId(req(), hoy)).not.toBe(
      await visitorId(req(), new Date("2026-11-18T15:00:00Z")),
    );
  });

  it("separa visitantes distintos y no filtra la IP", async () => {
    const con = (ip: string) =>
      new Request("https://agenda.test/mcp", { headers: { "cf-connecting-ip": ip } });
    const a = await visitorId(con("1.2.3.4"));
    const b = await visitorId(con("5.6.7.8"));
    expect(a).not.toBe(b);
    expect(a).not.toContain("1.2.3.4");
  });
});

describe("eventos del MCP", () => {
  it("describe cada request del body, incluso en batch", () => {
    const calls = mcpCalls([
      {
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          clientInfo: { name: "claude-ai", version: "1.0" },
        },
      },
      {
        id: 2,
        method: "tools/call",
        params: { name: "search", arguments: { collection: "eventos" } },
      },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      method: "initialize",
      cliente: "claude-ai",
      protocolo: "2025-06-18",
    });
    expect(calls[1]).toMatchObject({ method: "tools/call", tool: "search", collection: "eventos" });
  });

  it("registra el initialize con el cliente que lo pidió", async () => {
    const analytics = dataset();
    await post(envCon(analytics), "/mcp", {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-ai", version: "1.0" } },
    });
    expect(analytics.puntos).toHaveLength(1);
    const punto = analytics.puntos[0]!;
    expect(punto.blobs?.[0]).toBe("mcp");
    expect(punto.blobs?.[1]).toBe("initialize");
    expect(punto.blobs?.[4]).toBe("claude-ai");
    expect(punto.blobs?.[6]).toBe("ok");
    expect(punto.doubles).toEqual([1]);
    expect(punto.indexes).toEqual(["mcp:claude-ai"]);
  });

  it("marca la tool, la colección y el error de una consulta fallida", async () => {
    const analytics = dataset();
    await post(envCon(analytics), "/mcp", [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "search", arguments: { collection: "eventos", q: "tango" } },
      },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "no_existe" } },
    ]);
    expect(analytics.puntos).toHaveLength(2);
    expect(analytics.puntos[0]?.blobs?.slice(1, 4)).toEqual(["tools/call", "search", "eventos"]);
    expect(analytics.puntos[0]?.blobs?.[6]).toBe("ok");
    expect(analytics.puntos[1]?.blobs?.[6]).toBe("error");
    expect(analytics.puntos[1]?.blobs?.[7]).toBe("-32602");
  });

  it("también cuenta las notificaciones (respuesta 202)", async () => {
    const analytics = dataset();
    const res = await post(envCon(analytics), "/mcp", {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect(res.status).toBe(202);
    expect(analytics.puntos[0]?.blobs?.[1]).toBe("notifications/initialized");
  });

  it("sin binding de analytics el MCP responde igual", async () => {
    const res = await post(envCon(), "/mcp", { jsonrpc: "2.0", id: 1, method: "ping" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ result: {} });
  });
});

describe("POST /api/beacon", () => {
  it("registra un evento de la landing con su página", async () => {
    const analytics = dataset();
    const res = await post(envCon(analytics), "/api/beacon", {
      evento: "copiar_endpoint",
      pagina: "/",
    });
    expect(res.status).toBe(204);
    const punto = analytics.puntos[0]!;
    expect(punto.blobs?.[0]).toBe("web");
    expect(punto.blobs?.[1]).toBe("copiar_endpoint");
    expect(punto.blobs?.[11]).toBe("/");
    expect(punto.indexes).toEqual(["web:copiar_endpoint"]);
  });

  it("descarta eventos que no están en el catálogo", async () => {
    const analytics = dataset();
    const res = await post(envCon(analytics), "/api/beacon", { evento: "lo-que-sea" });
    expect(res.status).toBe(204);
    expect(analytics.puntos).toHaveLength(0);
  });

  it("descarta un body inválido sin romper", async () => {
    const analytics = dataset();
    const res = await worker.fetch(
      new Request("https://agenda.test/api/beacon", { method: "POST", body: "no es json" }),
      envCon(analytics),
    );
    expect(res.status).toBe(204);
    expect(analytics.puntos).toHaveLength(0);
  });

  it("sólo acepta POST", async () => {
    const res = await worker.fetch(new Request("https://agenda.test/api/beacon"), envCon());
    expect(res.status).toBe(405);
  });
});
