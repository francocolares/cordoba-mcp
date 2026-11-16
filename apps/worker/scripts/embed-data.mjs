#!/usr/bin/env node
/**
 * Embebe los datasets (agenda y farmacias) en un módulo TypeScript para que el
 * Worker no dependa de ningún storage: cada deploy lleva su propio snapshot.
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

const jsonl = (text) =>
  (text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));

const latest = (rows) => {
  let out = "";
  for (const row of rows) if (row.last_seen > out) out = row.last_seen;
  return out;
};

/* ------------------------------------------------------------- agenda ----- */

const eventsText = await readOptional(join(dataDir, "events.jsonl"));
if (eventsText === null) {
  console.warn(
    `[embed-data] no encontré ${join(dataDir, "events.jsonl")}: el Worker queda sin eventos.\n` +
      "            Corré `node apps/scraper/dist/index.js run` antes de desplegar.",
  );
}
const events = jsonl(eventsText);
const statusText = await readOptional(join(dataDir, "status.json"));
const status = statusText ? JSON.parse(statusText) : null;
const dataAsOf = status?.last_run ?? latest(events);

/* ---------------------------------------------------------- farmacias ----- */

const farmaciasDir = join(dataDir, "farmacias");
const pharmaciesText = await readOptional(join(farmaciasDir, "pharmacies.jsonl"));
if (pharmaciesText === null) {
  console.warn(
    `[embed-data] no encontré ${join(farmaciasDir, "pharmacies.jsonl")}: el Worker queda sin farmacias.\n` +
      "            Corré `node apps/scraper/dist/index.js farmacias ingest` antes de desplegar.",
  );
}
const pharmacies = jsonl(pharmaciesText);
const turnosText = await readOptional(join(farmaciasDir, "turnos.json"));
const calendars = turnosText ? (JSON.parse(turnosText).calendars ?? []) : [];
const farmaciasStatusText = await readOptional(join(farmaciasDir, "status.json"));
const farmaciasStatus = farmaciasStatusText ? JSON.parse(farmaciasStatusText) : null;
const farmaciasAsOf = farmaciasStatus?.last_run ?? latest(pharmacies);

const embed = (value) => `JSON.parse(${JSON.stringify(JSON.stringify(value))})`;

const body = `// Generado por scripts/embed-data.mjs — no editar a mano.
import type {
  Event,
  FarmaciasStatus,
  Pharmacy,
  RunStatus,
  TurnoCalendar,
} from "@cordoba/core/web";

export const EVENTS = ${embed(events)} as Event[];

export const STATUS = ${embed(status)} as RunStatus | null;

export const DATA_AS_OF = ${JSON.stringify(dataAsOf)};

export const PHARMACIES = ${embed(pharmacies)} as Pharmacy[];

export const TURNO_CALENDARS = ${embed(calendars)} as TurnoCalendar[];

export const FARMACIAS_STATUS = ${embed(farmaciasStatus)} as FarmaciasStatus | null;

export const FARMACIAS_DATA_AS_OF = ${JSON.stringify(farmaciasAsOf)};

export const EMBEDDED_AT = ${JSON.stringify(new Date().toISOString())};
`;

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, body, "utf8");
console.log(
  `[embed-data] ${events.length} eventos (data_as_of=${dataAsOf || "n/d"}) y ` +
    `${pharmacies.length} farmacias de ${calendars.length} año(s) -> src/data.generated.ts`,
);
