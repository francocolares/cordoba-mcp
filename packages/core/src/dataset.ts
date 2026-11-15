import { readFile } from "node:fs/promises";

import type { RunStatus } from "./models.js";
import { dataPaths, parseEventsJsonl } from "./store.js";
import type { AgendaSnapshot } from "./tools.js";

export interface Dataset extends AgendaSnapshot {
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

/** Cache en memoria con TTL (default 10 minutos). */
export class DatasetCache {
  private cached: Dataset | null = null;
  private readonly ttlMs: number;

  constructor(private readonly options: DatasetOptions = {}) {
    this.ttlMs = options.ttlMs ?? 10 * 60 * 1000;
  }

  async get(): Promise<Dataset> {
    if (this.cached && Date.now() - this.cached.loaded_at < this.ttlMs) return this.cached;
    this.cached = await loadDataset(this.options);
    return this.cached;
  }

  invalidate(): void {
    this.cached = null;
  }
}
