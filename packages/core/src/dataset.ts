import { readFile } from "node:fs/promises";
import type { EventosStore } from "./collections/eventos.js";
import type { FarmaciasTurnoStore } from "./collections/farmaciasTurno.js";
import type { FarmaciasStatus } from "./farmacias/models.js";
import { TurnoCalendarsSchema } from "./farmacias/models.js";
import { parsePharmaciesJsonl } from "./farmacias/store.js";
import type { RunStatus } from "./models.js";
import { dataPaths, parseEventsJsonl } from "./store.js";

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
  const eventsTarget = url ?? options.path ?? dataPaths().events;
  const text = await readSource(eventsTarget, Boolean(url));
  const events = parseEventsJsonl(text);

  // status.json vive al lado de events.jsonl, sea un path local o una URL raw.
  let status: RunStatus | null = null;
  const statusTarget = eventsTarget.replace(/events\.jsonl$/, "status.json");
  try {
    status = JSON.parse(await readSource(statusTarget, Boolean(url))) as RunStatus;
  } catch {
    status = null;
  }

  let latestSeen = "";
  for (const event of events) {
    if (event.last_seen > latestSeen) latestSeen = event.last_seen;
  }
  const dataAsOf = status?.last_run ?? latestSeen ?? new Date().toISOString();

  return { events, status, data_as_of: dataAsOf, loaded_at: Date.now() };
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

  const pharmaciesText = await readOptional(`${base}pharmacies.jsonl`, isUrl);
  if (pharmaciesText === null) return null;
  const pharmacies = parsePharmaciesJsonl(pharmaciesText);

  const turnosText = await readOptional(`${base}turnos.json`, isUrl);
  const calendars = turnosText ? TurnoCalendarsSchema.parse(JSON.parse(turnosText)).calendars : [];

  const statusText = await readOptional(`${base}status.json`, isUrl);
  const status = statusText ? (JSON.parse(statusText) as FarmaciasStatus) : null;

  let latestSeen = "";
  for (const pharmacy of pharmacies) {
    if (pharmacy.last_seen > latestSeen) latestSeen = pharmacy.last_seen;
  }

  return {
    pharmacies,
    calendars,
    status,
    data_as_of: status?.last_run ?? latestSeen ?? new Date().toISOString(),
  };
}
