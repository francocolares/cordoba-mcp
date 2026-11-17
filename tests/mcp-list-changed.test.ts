import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { createCordobaMcpServer } from "../apps/mcp/src/server.js";

const dataset = { path: join(import.meta.dirname, "..", "data", "events.jsonl") };

/** Cliente + servidor hablando por un par de transports en memoria. */
async function connect(options: { hideUnavailableTools?: boolean } = {}) {
  const mcp = createCordobaMcpServer({ dataset, ...options });
  const client = new Client({ name: "test", version: "0" });

  const notifications: string[] = [];
  client.setNotificationHandler(ToolListChangedNotificationSchema, (n) => {
    notifications.push(n.method);
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([mcp.server.connect(serverTransport), client.connect(clientTransport)]);

  const toolNames = async () => (await client.listTools()).tools.map((t) => t.name).sort();
  /** Las notificaciones viajan asincrónicamente: dejamos vaciar la cola. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  return { mcp, client, notifications, toolNames, settle };
}

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

describe("notifications/tools/list_changed (servidor stdio)", () => {
  it("declara la capability listChanged para tools y resources", async () => {
    const { mcp, client } = await connect();
    close = () => client.close();

    expect(mcp.server.server.getCapabilities()).toMatchObject({
      tools: { listChanged: true },
      resources: { listChanged: true },
    });
    // Lo que el cliente ve del otro lado del initialize.
    expect(client.getServerCapabilities()).toMatchObject({
      tools: { listChanged: true },
      resources: { listChanged: true },
    });
  });

  it("setToolEnabled notifica al cliente y el tools/list refleja el cambio", async () => {
    const { mcp, client, notifications, toolNames, settle } = await connect();
    close = () => client.close();

    const before = await toolNames();
    expect(before).toContain("pharmacies_on_duty");
    notifications.length = 0;

    expect(mcp.setToolEnabled("pharmacies_on_duty", false)).toBe(true);
    await settle();

    expect(notifications).toEqual(["notifications/tools/list_changed"]);
    const after = await toolNames();
    expect(after).not.toContain("pharmacies_on_duty");
    expect(after.length).toBe(before.length - 1);

    // Y vuelve, con una segunda notificación.
    expect(mcp.setToolEnabled("pharmacies_on_duty", true)).toBe(true);
    await settle();
    expect(notifications).toHaveLength(2);
    expect(await toolNames()).toEqual(before);
  });

  it("setToolEnabled es idempotente: sin cambio no hay notificación", async () => {
    const { mcp, client, notifications, settle } = await connect();
    close = () => client.close();
    notifications.length = 0;

    expect(mcp.setToolEnabled("pharmacies_on_duty", true)).toBe(false);
    expect(mcp.setToolEnabled("no_existe", false)).toBe(false);
    await settle();

    expect(notifications).toEqual([]);
  });

  it("refreshTools avisa sin tocar el set de tools", async () => {
    const { mcp, client, notifications, toolNames, settle } = await connect();
    close = () => client.close();

    const before = await toolNames();
    notifications.length = 0;

    mcp.refreshTools();
    await settle();

    expect(notifications).toEqual(["notifications/tools/list_changed"]);
    expect(await toolNames()).toEqual(before);
  });

  it("por defecto no esconde los tools de farmacias aunque falte el dataset", async () => {
    const { mcp, client, toolNames } = await connect({ hideUnavailableTools: false });
    close = () => client.close();

    mcp.syncToolsWithSnapshot({
      agenda: { events: [], status: null, data_as_of: "" },
      farmacias: null,
      loaded_at: Date.now(),
    });

    expect(await toolNames()).toContain("pharmacies_on_duty");
  });

  it("con hideUnavailableTools, el set sigue al estado del dataset de farmacias", async () => {
    const { mcp, client, notifications, toolNames, settle } = await connect({
      hideUnavailableTools: true,
    });
    close = () => client.close();

    const todos = await toolNames();
    notifications.length = 0;

    const agenda = { events: [], status: null, data_as_of: "" };
    mcp.syncToolsWithSnapshot({ agenda, farmacias: null, loaded_at: Date.now() });
    await settle();

    expect(notifications.length).toBeGreaterThan(0);
    const sinFarmacias = await toolNames();
    expect(sinFarmacias).not.toContain("pharmacies_on_duty");
    expect(sinFarmacias).toContain("search_events");

    mcp.syncToolsWithSnapshot({
      agenda,
      farmacias: { pharmacies: [], calendars: [], status: null, data_as_of: "" },
      loaded_at: Date.now(),
    });
    await settle();

    expect(await toolNames()).toEqual(todos);
  });
});
