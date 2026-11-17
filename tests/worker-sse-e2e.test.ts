/**
 * End to end con el cliente REAL del SDK contra el Worker, sin red: le
 * inyectamos un `fetch` que entra directo a `worker.fetch`. Replica el loop que
 * se validó en producción: handshake -> stream SSE -> cambio de revisión ->
 * notificación -> el cliente re-lista y ve la tool nueva.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../apps/worker/src/index.js";

const env: Env = {
  ASSETS: { fetch: async () => new Response("assets") },
  // TTL corto: es lo que fuerza la reconexión que entrega el aviso.
  MCP_SSE_TTL_S: "1",
};

const URL_ = "https://agenda.test/mcp";

/** fetch que corta la red y entra al Worker. */
const workerFetch: typeof fetch = (input, init) =>
  worker.fetch(new Request(input as string | URL, init), env);

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("cliente del SDK contra el Worker", () => {
  it("hace el handshake, guarda la sesión y abre el stream SSE", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(URL_), { fetch: workerFetch });
    const client = new Client({ name: "e2e", version: "0" });
    close = () => client.close();

    await client.connect(transport);

    expect(client.getServerCapabilities()).toMatchObject({
      tools: { listChanged: true },
      resources: { listChanged: true },
    });
    // El transport se quedó con el id que emitimos en el initialize.
    expect(transport.sessionId).toBeTruthy();

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("search_events");
  });

  it("un cliente con sesión de otra revisión recibe tools/list_changed UNA vez", async () => {
    // El escenario real: el cliente hizo el handshake antes del deploy y NO
    // vuelve a inicializar; sólo reconecta su stream con la sesión que ya tenía.
    // Para reproducirlo sin tocar la revisión del bundle, reescribimos el header
    // de sesión en el GET, que es lo que el server mira para decidir.
    const staleFetch: typeof fetch = (input, init) => {
      const request = new Request(input as string | URL, init);
      if (request.method !== "GET") return worker.fetch(request, env);
      const headers = new Headers(request.headers);
      headers.set("mcp-session-id", "revision-vieja~abc");
      return worker.fetch(new Request(request, { headers }), env);
    };

    const transport = new StreamableHTTPClientTransport(new URL(URL_), { fetch: staleFetch });
    const client = new Client({ name: "e2e-stale", version: "0" });
    close = () => client.close();

    const avisos: string[] = [];
    client.setNotificationHandler(ToolListChangedNotificationSchema, (n) => {
      avisos.push(n.method);
    });

    await client.connect(transport);
    // Con TTL de 1s el cliente reconecta varias veces en esta ventana. El aviso
    // tiene que llegar una sola vez: es la regresión del bug que en producción
    // re-notificaba cada ~44s para siempre, porque el cliente nunca rota su
    // Mcp-Session-Id y el resumption token se perdía entre streams.
    await settle(3500);

    expect(avisos).toEqual(["notifications/tools/list_changed"]);

    // Y el re-list sigue funcionando después del aviso.
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("search_events");
  });

  it("un cliente al día no recibe avisos, ni siquiera tras varias reconexiones", async () => {
    // Es la regresión del bug que apareció sólo en producción: con TTL de 1s
    // este cliente reconecta varias veces en la ventana del test, y cada
    // reconexión volvía a verse "stale" -> notificaba para siempre.
    const transport = new StreamableHTTPClientTransport(new URL(URL_), { fetch: workerFetch });
    const client = new Client({ name: "e2e-fresh", version: "0" });
    close = () => client.close();

    const avisos: string[] = [];
    client.setNotificationHandler(ToolListChangedNotificationSchema, (n) => {
      avisos.push(n.method);
    });

    await client.connect(transport);
    await settle(3500);

    expect(avisos).toEqual([]);
  });
});
