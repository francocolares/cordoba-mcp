import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  type ChangeRecord,
  CONTENT_FIELDS,
  type Counts,
  type Event,
  EventSchema,
  type RunStatus,
} from "./models.js";

export interface Paths {
  root: string;
  events: string;
  changes: string;
  status: string;
  raw: string;
}

export function dataPaths(root = "data"): Paths {
  const abs = resolve(root);
  return {
    root: abs,
    events: join(abs, "events.jsonl"),
    changes: join(abs, "changes.jsonl"),
    status: join(abs, "status.json"),
    raw: join(abs, "raw"),
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

export function parseEventsJsonl(text: string): Event[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line, i) => {
      const parsed = EventSchema.safeParse(JSON.parse(line));
      if (!parsed.success) {
        throw new Error(`events.jsonl línea ${i + 1} inválida: ${parsed.error.message}`);
      }
      return parsed.data;
    });
}

export async function loadEvents(paths: Paths = dataPaths()): Promise<Event[]> {
  const text = await readIfExists(paths.events);
  return text ? parseEventsJsonl(text) : [];
}

/** Ordenado por id para que los diffs de git sean estables. */
export function serializeEvents(events: Event[]): string {
  const sorted = [...events].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return `${sorted.map((e) => JSON.stringify(e)).join("\n")}\n`;
}

export async function saveEvents(events: Event[], paths: Paths = dataPaths()): Promise<void> {
  await mkdir(dirname(paths.events), { recursive: true });
  await writeFile(paths.events, serializeEvents(events), "utf8");
}

export async function appendChanges(
  changes: ChangeRecord[],
  paths: Paths = dataPaths(),
): Promise<void> {
  if (changes.length === 0) return;
  await mkdir(dirname(paths.changes), { recursive: true });
  await appendFile(paths.changes, `${changes.map((c) => JSON.stringify(c)).join("\n")}\n`, "utf8");
}

/** Un snapshot por día; si ya existe, se sobrescribe. */
export async function saveRaw(
  payload: unknown,
  day: string,
  paths: Paths = dataPaths(),
): Promise<string> {
  await mkdir(paths.raw, { recursive: true });
  const file = join(paths.raw, `${day}.json`);
  await writeFile(file, `${JSON.stringify(payload, null, 1)}\n`, "utf8");
  return file;
}

export async function saveStatus(status: RunStatus, paths: Paths = dataPaths()): Promise<void> {
  await mkdir(dirname(paths.status), { recursive: true });
  await writeFile(paths.status, `${JSON.stringify(status, null, 2)}\n`, "utf8");
}

export async function loadStatus(paths: Paths = dataPaths()): Promise<RunStatus | null> {
  const text = await readIfExists(paths.status);
  return text ? (JSON.parse(text) as RunStatus) : null;
}

export function schemaHash(columns: readonly string[]): string {
  return createHash("sha256").update(columns.join("|"), "utf8").digest("hex").slice(0, 16);
}

export interface MergeResult {
  events: Event[];
  changes: ChangeRecord[];
  counts: Counts;
}

/** Lo mínimo que una entidad necesita para entrar al merge con histórico. */
export interface Mergeable {
  id: string;
  content_hash: string;
  active: boolean;
  first_seen: string;
  last_seen: string;
}

export interface MergeEntitiesResult<T> {
  items: T[];
  changes: ChangeRecord[];
  counts: Counts;
}

function fieldDiff<T>(
  previous: T,
  next: T,
  fields: readonly (keyof T)[],
): Record<string, [unknown, unknown]> {
  const diff: Record<string, [unknown, unknown]> = {};
  for (const field of fields) {
    if (previous[field] !== next[field]) diff[String(field)] = [previous[field], next[field]];
  }
  return diff;
}

/**
 * Funde el estado anterior con lo que trajo la fuente:
 * alta / sigue presente / baja (active=false, una sola vez) / readded.
 * Genérico porque lo usan la agenda (eventos) y las farmacias.
 */
export function mergeEntities<T extends Mergeable>(
  previous: T[],
  fetched: T[],
  now: string,
  options: { contentFields: readonly (keyof T)[]; titleOf: (item: T) => string },
): MergeEntitiesResult<T> {
  const byId = new Map(previous.map((item) => [item.id, item]));
  const fetchedIds = new Set(fetched.map((item) => item.id));
  const changes: ChangeRecord[] = [];
  const result: T[] = [];
  const counts: Counts = {
    total: 0,
    active: 0,
    inactive: 0,
    added: 0,
    updated: 0,
    removed: 0,
    readded: 0,
  };

  for (const next of fetched) {
    const prev = byId.get(next.id);
    if (!prev) {
      result.push({ ...next, first_seen: now, last_seen: now, active: true });
      changes.push({ at: now, kind: "added", id: next.id, title: options.titleOf(next) });
      counts.added++;
      continue;
    }
    result.push({ ...next, first_seen: prev.first_seen, last_seen: now, active: true });
    if (!prev.active) {
      changes.push({ at: now, kind: "readded", id: next.id, title: options.titleOf(next) });
      counts.readded++;
    }
    if (prev.content_hash !== next.content_hash) {
      changes.push({
        at: now,
        kind: "updated",
        id: next.id,
        title: options.titleOf(next),
        fields: fieldDiff(prev, next, options.contentFields),
      });
      counts.updated++;
    }
  }

  for (const prev of previous) {
    if (fetchedIds.has(prev.id)) continue;
    if (prev.active) {
      changes.push({ at: now, kind: "removed", id: prev.id, title: options.titleOf(prev) });
      counts.removed++;
      result.push({ ...prev, active: false });
    } else {
      result.push(prev);
    }
  }

  counts.total = result.length;
  counts.active = result.filter((item) => item.active).length;
  counts.inactive = counts.total - counts.active;
  return { items: result, changes, counts };
}

export function merge(previous: Event[], scraped: Event[], now: string): MergeResult {
  const { items, changes, counts } = mergeEntities(previous, scraped, now, {
    contentFields: CONTENT_FIELDS,
    titleOf: (event) => event.title,
  });
  return { events: items, changes, counts };
}
