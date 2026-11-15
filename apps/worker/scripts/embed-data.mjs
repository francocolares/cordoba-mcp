#!/usr/bin/env node
/**
 * Embebe data/events.jsonl y data/status.json en un módulo TypeScript para que
 * el Worker no dependa de ningún storage: cada deploy lleva su propio snapshot.
 * Se regenera en cada build; el archivo generado no se commitea.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const dataDir = process.env.AGENDA_DATA_DIR ?? join(repoRoot, "data");
const outFile = join(here, "..", "src", "data.generated.ts");

async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

const eventsText = await readOptional(join(dataDir, "events.jsonl"));
const statusText = await readOptional(join(dataDir, "status.json"));

if (eventsText === null) {
  console.warn(
    `[embed-data] no encontré ${join(dataDir, "events.jsonl")}: el Worker queda sin eventos.\n` +
      "            Corré `node apps/scraper/dist/index.js run` antes de desplegar.",
  );
}

const events = (eventsText ?? "")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line !== "")
  .map((line) => JSON.parse(line));

const status = statusText ? JSON.parse(statusText) : null;

let latestSeen = "";
for (const event of events) {
  if (event.last_seen > latestSeen) latestSeen = event.last_seen;
}
const dataAsOf = status?.last_run ?? latestSeen;

const body = `// Generado por scripts/embed-data.mjs — no editar a mano.
import type { Event, RunStatus } from "@cordoba/core/web";

export const EVENTS = JSON.parse(${JSON.stringify(JSON.stringify(events))}) as Event[];

export const STATUS = JSON.parse(${JSON.stringify(JSON.stringify(status))}) as RunStatus | null;

export const DATA_AS_OF = ${JSON.stringify(dataAsOf)};

export const EMBEDDED_AT = ${JSON.stringify(new Date().toISOString())};
`;

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, body, "utf8");
console.log(
  `[embed-data] ${events.length} eventos embebidos (data_as_of=${dataAsOf || "n/d"}) -> src/data.generated.ts`,
);
