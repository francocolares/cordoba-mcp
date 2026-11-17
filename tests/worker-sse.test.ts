import { describe, expect, it } from "vitest";
import worker, { type Env } from "../apps/worker/src/index.js";
import { newSessionId, revisionOf, TOOLS_REVISION } from "../apps/worker/src/mcp.js";
import { DEFAULT_TTL_S, needsListChanged, resolveTtlS } from "../apps/worker/src/sse.js";

const env: Env = {
  ASSETS: { fetch: async () => new Response("assets") },
  // TTL mínimo: los tests necesitan ver el stream cerrarse sin esperar 60s.
  MCP_SSE_TTL_S: "1",
};

const call = (path: string, init?: RequestInit) =>
  worker.fetch(new Request(`https://agenda.test${path}`, init), env);

const rpc = (body: unknown, headers: Record<string, string> = {}) =>
  call("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: {} };

/** Lee el stream SSE completo (cierra por TTL) con un tope de seguridad. */
async function readStream(res: Response, maxMs = 8000): Promise<string> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  const deadline = Date.now() + maxMs;
  let out = "";
  for (;;) {
    if (Date.now() > deadline) {
      await reader.cancel();
      break;
    }
    const { value, done } = await reader.read();
    if (done) break;
    out += value;
  }
  return out;
}

const sse = (headers: Record<string, string> = {}) =>
  call("/mcp", { method: "GET", headers: { accept: "text/event-stream", ...headers } });

describe("sesiones del endpoint HTTP", () => {
  it("el initialize declara listChanged para tools y resources", async () => {
    const body = (await (await rpc(INIT)).json()) as {
      result: { capabilities: Record<string, unknown> };
    };
    expect(body.result.capabilities).toEqual({
      tools: { listChanged: true },
      resources: { listChanged: true },
    });
  });

  it("el initialize emite Mcp-Session-Id con la revisión de tools adentro", async () => {
    const res = await rpc(INIT);
    const sessionId = res.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
    expect(revisionOf(sessionId)).toBe(TOOLS_REVISION);
  });

  it("los demás métodos no emiten sesión nueva", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(res.headers.get("mcp-session-id")).toBeNull();
  });

  it("expone el header de sesión al browser", async () => {
    const res = await call("/mcp", { method: "OPTIONS" });
    expect(res.headers.get("access-control-expose-headers")).toContain("mcp-session-id");
  });

  it("/health publica la revisión de tools", async () => {
    const body = (await (await call("/health")).json()) as Record<string, unknown>;
    expect(body["tools_revision"]).toBe(TOOLS_REVISION);
  });
});

describe("needsListChanged", () => {
  const req = (headers: Record<string, string>) =>
    new Request("https://agenda.test/mcp", { headers });

  it("no avisa sin sesión: el cliente recién hizo el handshake", () => {
    expect(needsListChanged(req({}))).toBe(false);
  });

  it("no avisa si la sesión es de la revisión actual", () => {
    expect(needsListChanged(req({ "mcp-session-id": newSessionId() }))).toBe(false);
  });

  it("avisa si la sesión es de una revisión vieja", () => {
    expect(needsListChanged(req({ "mcp-session-id": "vieja~abc" }))).toBe(true);
  });

  it("no re-avisa si el Last-Event-ID ya es de la revisión actual", () => {
    // Es el caso que en producción hacía re-notificar cada ~44s para siempre.
    expect(
      needsListChanged(
        req({ "mcp-session-id": "vieja~abc", "last-event-id": `${TOOLS_REVISION}:ka3` }),
      ),
    ).toBe(false);
  });

  it("vuelve a avisar si el Last-Event-ID es de otra revisión", () => {
    expect(
      needsListChanged(req({ "mcp-session-id": "vieja~abc", "last-event-id": "otra:ka3" })),
    ).toBe(true);
  });
});

describe("GET /mcp (canal SSE)", () => {
  it("sin Accept text/event-stream sigue devolviendo 405", async () => {
    const res = await call("/mcp", { method: "GET" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toContain("GET");
  });

  it("con Accept text/event-stream abre el stream", async () => {
    const res = await sse();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    await res.body?.cancel();
  });

  it("manda retry y keepalives con id, y cierra por TTL", async () => {
    const text = await readStream(await sse());
    expect(text).toContain("retry: ");
    // El keepalive necesita id Y data no vacía, o el cliente no refresca su
    // resumption token (la spec SSE no despacha con el data buffer vacío).
    expect(text).toMatch(new RegExp(`^id: ${TOOLS_REVISION}:ka\\d+$`, "m"));
    expect(text).toMatch(/^event: keepalive$/m);
    expect(text).toMatch(/^data: \d+$/m);
    // Sin sesión vieja no hay notificación.
    expect(text).not.toContain("list_changed");
  });

  it("a un cliente con la lista vieja le manda list_changed al conectar", async () => {
    const text = await readStream(await sse({ "mcp-session-id": "vieja~abc" }));
    expect(text).toContain("notifications/tools/list_changed");
    expect(text).toContain("notifications/resources/list_changed");
    expect(text).toMatch(new RegExp(`^id: ${TOOLS_REVISION}:n\\d+$`, "m"));
    // El payload tiene que ser un mensaje JSON-RPC válido.
    const line = text.split("\n").find((l) => l.includes("tools/list_changed"))!;
    expect(JSON.parse(line.replace(/^data: /, ""))).toEqual({
      jsonrpc: "2.0",
      method: "notifications/tools/list_changed",
    });
  });

  it("no re-notifica a quien ya recibió el aviso de esta revisión", async () => {
    const text = await readStream(
      await sse({ "mcp-session-id": "vieja~abc", "last-event-id": `${TOOLS_REVISION}:n1` }),
    );
    expect(text).not.toContain("list_changed");
  });
});

describe("resolveTtlS", () => {
  it("default cuando falta o no es válido", () => {
    expect(resolveTtlS(undefined)).toBe(DEFAULT_TTL_S);
    expect(resolveTtlS("")).toBe(DEFAULT_TTL_S);
    expect(resolveTtlS("abc")).toBe(DEFAULT_TTL_S);
    expect(resolveTtlS("0")).toBe(DEFAULT_TTL_S);
    expect(resolveTtlS("-5")).toBe(DEFAULT_TTL_S);
  });

  it("respeta el valor y lo acota", () => {
    expect(resolveTtlS("30")).toBe(30);
    expect(resolveTtlS("99999")).toBe(600);
  });
});

describe("la revisión de tools", () => {
  it("es estable entre llamadas", () => {
    expect(TOOLS_REVISION).toBe(TOOLS_REVISION);
    expect(TOOLS_REVISION).toMatch(/^[a-z0-9]+$/);
  });

  it("revisionOf tolera basura", () => {
    expect(revisionOf(null)).toBeNull();
    expect(revisionOf("")).toBeNull();
    expect(revisionOf("~sinrevision")).toBeNull();
    expect(revisionOf("abc")).toBe("abc");
  });
});
