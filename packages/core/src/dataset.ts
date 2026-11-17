/**
 * Carga de los datasets desde el filesystem o una URL raw. Lo usa el build de
 * la landing (Astro corre en Node); el Worker carga de R2 con su propio código,
 * pero la **hidratación es la misma**: ambos terminan llamando a
 * `collection.hydrate()`, así que el armado del store se escribe una sola vez
 * por colección (ver packages/core/src/collections/).
 */
import { readFile } from "node:fs/promises";
import type { EventosStore } from "./collections/eventos.js";
import { eventos } from "./collections/eventos.js";
import type { FarmaciasTurnoStore } from "./collections/farmaciasTurno.js";
import { farmaciasTurno } from "./collections/farmaciasTurno.js";
import { dataPaths } from "./store.js";

export interface Dataset extends EventosStore {
  loaded_at: number;
}

export interface DatasetOptions {
  /** URL raw de GitHub. Tiene prioridad sobre `path`. */
  url?: string | undefined;
  path?: string | undefined;
  ttlMs?: number;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} al bajar ${url}`);
  return res.text();
}

async function readSource(target: string, isUrl: boolean): Promise<string> {
  return isUrl ? fetchText(target) : readFile(target, "utf8");
}

async function readOptional(target: string, isUrl: boolean): Promise<string | null> {
  try {
    return await readSource(target, isUrl);
  } catch {
    return null;
  }
}

export async function loadDataset(options: DatasetOptions = {}): Promise<Dataset> {
  const url = options.url;
  const isUrl = Boolean(url);
  const eventsTarget = url ?? options.path ?? dataPaths().events;
  const records = await readSource(eventsTarget, isUrl);
  // status.json vive al lado de events.jsonl, sea un path local o una URL raw.
  const status = await readOptional(eventsTarget.replace(/events\.jsonl$/, "status.json"), isUrl);

  const store = eventos.hydrate({ records, extras: { "status.json": status } }) as EventosStore;
  return { ...store, loaded_at: Date.now() };
}

/** Las farmacias viven en `<data>/farmacias/`, al lado de events.jsonl. */
export function farmaciasBase(eventsTarget: string): string {
  return eventsTarget.replace(/events\.jsonl$/, "farmacias/");
}

export async function loadFarmaciasDataset(
  options: DatasetOptions = {},
): Promise<FarmaciasTurnoStore | null> {
  const url = options.url;
  const isUrl = Boolean(url);
  const base = farmaciasBase(url ?? options.path ?? dataPaths().events);

  const records = await readOptional(`${base}pharmacies.jsonl`, isUrl);
  if (records === null) return null;

  return farmaciasTurno.hydrate({
    records,
    extras: {
      "status.json": await readOptional(`${base}status.json`, isUrl),
      "turnos.json": await readOptional(`${base}turnos.json`, isUrl),
    },
  }) as FarmaciasTurnoStore;
}
