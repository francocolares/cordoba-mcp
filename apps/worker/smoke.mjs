/**
 * Smoke test del MCP remoto con el cliente oficial por streamable HTTP.
 * Uso: node smoke.mjs [url]   (default: http://127.0.0.1:8799/mcp, el de `wrangler dev`)
 *
 * Recorre la superficie completa: son cuatro tools, así que esto también es la
 * verificación de que el catálogo entero se sirve sin tools por fuente.
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
  if (payload.error) {
    console.log(`${name}(${JSON.stringify(args ?? {})}) -> error ${payload.error.code}`);
    return payload;
  }
  const label = payload.count ?? payload.collections?.length ?? "ok";
  console.log(`${name}(${JSON.stringify(args ?? {})}) -> ${label}`);
  return payload;
};

const catalogo = await call("list_collections", { include: ["taxonomies", "examples"] });
const ids = catalogo.collections.map((c) => c.id);
console.log("colecciones:", ids.join(", "), "| catalog_version:", catalogo.catalog_version);

// Eventos: texto, un día, el finde y el detalle por id.
await call("search", { collection: "eventos", query: "museo", limit: 3 });
await call("search", { collection: "eventos", date: { from: "hoy", to: "hoy" } });
const finde = await call("search", {
  collection: "eventos",
  date: { from: "fin_de_semana" },
  filters: { free_only: true },
});
const primero = (await call("search", { collection: "eventos", limit: 1 })).items[0];
if (primero) await call("get", { ids: [primero.id] });

// Farmacias: el turno de hoy, por cercanía, y el padrón completo.
const guardia = await call("search", { collection: "farmacias_turno", limit: 3 });
await call("search", {
  collection: "farmacias_turno",
  near: { lat: -31.4201, lon: -64.1888, radius_km: 2 },
  limit: 3,
});
await call("search", {
  collection: "farmacias_turno",
  query: "farmacity",
  filters: { on_duty: false },
  limit: 2,
});
await call("search", { collection: "farmacias_turno", group_by: "seccion", limit: 1 });

// Que un error sea legible y traiga los valores válidos es parte del contrato.
const malFiltro = await call("search", { collection: "eventos", filters: { barrio: "Centro" } });
console.log("filtro inválido ->", malFiltro.error.code, malFiltro.error.valid_values);

const { resources } = await client.listResources();
console.log("resources:", resources.map((r) => r.uri).join(", "));
const read = await client.readResource({ uri: "cordoba://catalog" });
console.log("cordoba://catalog ->", read.contents[0].text.length, "bytes");

const status = await call("source_status");
console.log(
  "\nestado:",
  status.collections
    .map((c) => `${c.id}=${c.available ? (c.records ?? "?") : "no cargada"}`)
    .join(" | "),
);
console.log("finde:", finde.resolved, `(${finde.total} gratis)`);
console.log(
  "guardia de hoy: turno",
  guardia.turno,
  `(${guardia.duty_total} farmacias)`,
  guardia.window,
);
console.log("notas:", (guardia.notes ?? []).join(" "));
await client.close();
