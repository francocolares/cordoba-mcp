import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Paths absolutos: así corre igual desde la raíz (`node apps/mcp/smoke.mjs`) que
// con pnpm, que pone el cwd en apps/mcp.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

const transport = new StdioClientTransport({
  command: "node",
  args: [join(here, "dist", "index.js")],
  env: {
    ...process.env,
    AGENDA_DATA_PATH: process.env.AGENDA_DATA_PATH ?? join(repoRoot, "data", "events.jsonl"),
  },
});
const client = new Client({ name: "smoke", version: "0" });
await client.connect(transport);
const tools = await client.listTools();
console.log(
  "tools:",
  tools.tools.map((t) => t.name),
);
const show = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  const j = JSON.parse(r.content[0].text);
  console.log(`\n== ${name}`, JSON.stringify(args ?? {}));
  console.log("  data_as_of:", j.data_as_of, "count:", j.count ?? j.categories?.length ?? "-");
  if (j.events)
    console.log(
      "  " +
        j.events
          .slice(0, 3)
          .map((e) => `${e.start} ${e.price_type} ${e.title}`)
          .join("\n  "),
    );
  if (j.categories) console.log(`  ${JSON.stringify(j.categories)}`);
  if (j.range) console.log("  range:", j.range);
  if (j.event) console.log("  event:", j.event.title, "| link:", j.link);
  if (j.agenda)
    console.log("  agenda:", j.agenda.status?.validation?.status, j.agenda.status?.counts);
  if (j.farmacias) console.log("  farmacias:", JSON.stringify(j.farmacias.years ?? j.farmacias));
  if (j.pharmacies)
    console.log(
      "  " +
        j.pharmacies
          .slice(0, 3)
          .map(
            (p) =>
              `turno ${p.turno} secc ${p.section} ${p.name ?? p.raw}` +
              (p.distance_km === undefined ? "" : ` (${p.distance_km} km)`),
          )
          .join("\n  "),
    );
  if (j.sections) console.log("  secciones:", JSON.stringify(j.sections));
};
await show("search_events", { query: "museo", limit: 3 });
await show("search_events", { free_only: true, limit: 3 });
await show("events_on", { date: "mañana" });
await show("this_weekend", { free_only: true });
await show("list_categories");
await show("source_status");
const first = JSON.parse(
  (await client.callTool({ name: "search_events", arguments: { limit: 1 } })).content[0].text,
).events[0];
await show("get_event", { id: first.id });
const res = await client.readResource({ uri: "agenda://status" });
console.log(
  "\nresource agenda://status ->",
  res.contents[0].mimeType,
  res.contents[0].text.length,
  "bytes",
);
const bad = await client.callTool({ name: "get_event", arguments: { id: "nope" } });
console.log("get_event inexistente isError:", bad.isError);

// --- farmacias de turno
await show("duty_turno_on", { date: "hoy" });
await show("pharmacies_on_duty", { date: "hoy", limit: 3 });
// Plaza San Martín, para ver el orden por distancia.
await show("pharmacies_near", { lat: -31.4201, lon: -64.1888, radius_km: 2, limit: 3 });
await show("find_pharmacy", { query: "farmacity", limit: 2 });
const farmacia = JSON.parse(
  (await client.callTool({ name: "pharmacies_on_duty", arguments: { limit: 1 } })).content[0].text,
).pharmacies[0];
if (farmacia) {
  const detalle = JSON.parse(
    (await client.callTool({ name: "get_pharmacy", arguments: { id: farmacia.id } })).content[0]
      .text,
  );
  console.log(
    "\n== get_pharmacy",
    detalle.pharmacy.name,
    "| próximas guardias:",
    detalle.next_duty_dates.map((d) => `${d.date}${d.derived ? " (proyectada)" : ""}`).join(", "),
  );
  console.log("  ventana:", JSON.stringify(detalle.turno_window), "\n  ", detalle.disclaimer);
}
await client.close();
