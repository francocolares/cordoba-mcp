/** Persistencia de las farmacias: JSONL + JSON en `data/farmacias/`. */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { ChangeRecord } from "../models.js";
import {
  type FarmaciasStatus,
  type Pharmacy,
  PharmacySchema,
  type TurnoCalendar,
  TurnoCalendarsSchema,
} from "./models.js";
import type { GeocodeCache } from "./normalize.js";

export interface FarmaciasPaths {
  root: string;
  dir: string;
  pharmacies: string;
  turnos: string;
  geocode: string;
  changes: string;
  status: string;
  raw: string;
}

export function farmaciasPaths(root = "data"): FarmaciasPaths {
  const abs = resolve(root);
  const dir = join(abs, "farmacias");
  return {
    root: abs,
    dir,
    pharmacies: join(dir, "pharmacies.jsonl"),
    turnos: join(dir, "turnos.json"),
    geocode: join(dir, "geocode.json"),
    changes: join(dir, "changes.jsonl"),
    status: join(dir, "status.json"),
    raw: join(abs, "raw", "farmacias"),
  };
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export function parsePharmaciesJsonl(text: string): Pharmacy[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line, i) => {
      const parsed = PharmacySchema.safeParse(JSON.parse(line));
      if (!parsed.success) {
        throw new Error(`pharmacies.jsonl línea ${i + 1} inválida: ${parsed.error.message}`);
      }
      return parsed.data;
    });
}

/** Ordenado por id para que los diffs de git sean estables. */
export function serializePharmacies(pharmacies: Pharmacy[]): string {
  const sorted = [...pharmacies].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return `${sorted.map((p) => JSON.stringify(p)).join("\n")}\n`;
}

export async function loadPharmacies(
  paths: FarmaciasPaths = farmaciasPaths(),
): Promise<Pharmacy[]> {
  const text = await readIfExists(paths.pharmacies);
  return text ? parsePharmaciesJsonl(text) : [];
}

export async function savePharmacies(
  pharmacies: Pharmacy[],
  paths: FarmaciasPaths = farmaciasPaths(),
): Promise<void> {
  await mkdir(dirname(paths.pharmacies), { recursive: true });
  await writeFile(paths.pharmacies, serializePharmacies(pharmacies), "utf8");
}

export async function loadCalendars(
  paths: FarmaciasPaths = farmaciasPaths(),
): Promise<TurnoCalendar[]> {
  const text = await readIfExists(paths.turnos);
  if (!text) return [];
  const parsed = TurnoCalendarsSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(`turnos.json inválido: ${parsed.error.message}`);
  return parsed.data.calendars;
}

export async function saveCalendars(
  calendars: TurnoCalendar[],
  paths: FarmaciasPaths = farmaciasPaths(),
): Promise<void> {
  const sorted = [...calendars].sort((a, b) => a.year - b.year);
  await mkdir(dirname(paths.turnos), { recursive: true });
  await writeFile(paths.turnos, `${JSON.stringify({ calendars: sorted }, null, 1)}\n`, "utf8");
}

export async function loadGeocodeCache(
  paths: FarmaciasPaths = farmaciasPaths(),
): Promise<GeocodeCache> {
  const text = await readIfExists(paths.geocode);
  return text ? (JSON.parse(text) as GeocodeCache) : {};
}

/** Con las claves ordenadas: la cache se commitea y el diff tiene que ser legible. */
export async function saveGeocodeCache(
  cache: GeocodeCache,
  paths: FarmaciasPaths = farmaciasPaths(),
): Promise<void> {
  const ordered: GeocodeCache = {};
  for (const key of Object.keys(cache).sort()) ordered[key] = cache[key]!;
  await mkdir(dirname(paths.geocode), { recursive: true });
  await writeFile(paths.geocode, `${JSON.stringify(ordered, null, 1)}\n`, "utf8");
}

export async function appendFarmaciasChanges(
  changes: ChangeRecord[],
  paths: FarmaciasPaths = farmaciasPaths(),
): Promise<void> {
  if (changes.length === 0) return;
  await mkdir(dirname(paths.changes), { recursive: true });
  await appendFile(paths.changes, `${changes.map((c) => JSON.stringify(c)).join("\n")}\n`, "utf8");
}

export async function saveFarmaciasStatus(
  status: FarmaciasStatus,
  paths: FarmaciasPaths = farmaciasPaths(),
): Promise<void> {
  await mkdir(dirname(paths.status), { recursive: true });
  await writeFile(paths.status, `${JSON.stringify(status, null, 2)}\n`, "utf8");
}

export async function loadFarmaciasStatus(
  paths: FarmaciasPaths = farmaciasPaths(),
): Promise<FarmaciasStatus | null> {
  const text = await readIfExists(paths.status);
  return text ? (JSON.parse(text) as FarmaciasStatus) : null;
}

/** Guarda el .xlsx como snapshot: es la fuente de verdad del año. */
export async function saveTurneroFile(
  buffer: Buffer,
  year: number,
  paths: FarmaciasPaths = farmaciasPaths(),
): Promise<string> {
  await mkdir(paths.raw, { recursive: true });
  const file = join(paths.raw, `turnero-${year}.xlsx`);
  await writeFile(file, buffer);
  return file;
}
