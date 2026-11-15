/**
 * Smoke test del MCP remoto con el cliente oficial por streamable HTTP.
 * Uso: node smoke.mjs [url]   (default: http://127.0.0.1:8799/mcp, el de `wrangler dev`)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.argv[2] ?? "http://127.0.0.1:8799/mcp");
const client = new Client({ name: "worker-smoke", version: "0" });
await client.connect(new StreamableHTTPClientTransport(url));

const { tools } = await client.listTools();
console.log(`tools (${tools.length}):`, tools.map((t) => t.name).join(", "));

const call = async (name, args) => {
  const res = await client.callTool({ name, arguments: args });
  const payload = JSON.parse(res.content[0].text);
  const label = payload.count ?? payload.categories?.length ?? payload.event?.title ?? "ok";
  console.log(`${name}(${JSON.stringify(args ?? {})}) -> ${label}`);
  return payload;
};

await call("search_events", { query: "museo", limit: 3 });
await call("events_on", { date: "hoy" });
const weekend = await call("this_weekend", { free_only: true });
await call("list_categories");
const status = await call("source_status");
const first = (await call("search_events", { limit: 1 })).events[0];
await call("get_event", { id: first.id });

const { resources } = await client.listResources();
console.log("resources:", resources.map((r) => r.uri).join(", "));
const read = await client.readResource({ uri: "agenda://status" });
console.log("agenda://status ->", read.contents[0].text.length, "bytes");

console.log("\ndata_as_of:", status.data_as_of, "| validación:", status.status?.validation?.status);
console.log("finde:", weekend.range, `(${weekend.count} gratis)`);
await client.close();
