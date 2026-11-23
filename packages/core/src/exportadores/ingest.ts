import { readFile } from "node:fs/promises";

import { isoDate, todayInCordoba } from "../datetime.js";
import type { ChangeRecord, Counts, ValidationResult } from "../models.js";
import { mergeEntities } from "../store.js";
import { EXPORTADORES_SOURCE_ID, EXPORTADORES_SOURCE_NAME } from "./config.js";
import type { ExportadoresStatus, Exporter } from "./models.js";
import { EXPORTER_SCALAR_FIELDS } from "./models.js";
import type { ExcludedCounts, ExporterInput } from "./normalize.js";
import { directoryIdsHash, readDirectorioFile, toExporters } from "./normalize.js";
import {
  appendExportadoresChanges,
  type ExportadoresPaths,
  exportadoresPaths,
  loadExportadoresStatus,
  loadExporters,
  saveCrawlSnapshot,
  saveExportadoresStatus,
  saveExporters,
} from "./store.js";
import { validateExporters } from "./validate.js";

export interface IngestExportadoresOptions {
  inputs: readonly ExporterInput[];
  directoryTotal: number;
  directoryIds?: readonly string[] | undefined;
  crawledAt?: string | null | undefined;
  partial?: boolean;
  paths?: ExportadoresPaths;
  now?: Date;
  persist?: boolean;
  warnings?: readonly string[];
  snapshot?: unknown;
}

export interface IngestExportadoresResult {
  validation: ValidationResult;
  status: ExportadoresStatus;
  changes: ChangeRecord[];
  warnings: string[];
  excluded: ExcludedCounts;
  persisted: boolean;
  rawFile: string | null;
}

const emptyCounts = (): Counts => ({
  total: 0,
  active: 0,
  inactive: 0,
  added: 0,
  updated: 0,
  removed: 0,
  readded: 0,
});

interface MergeOutcome {
  items: Exporter[];
  changes: ChangeRecord[];
  counts: Counts;
}

export function mergeExporters(
  previous: readonly Exporter[],
  fetched: readonly Exporter[],
  now: string,
  partial: boolean,
): MergeOutcome {
  const fetchedIds = new Set(fetched.map((e) => e.id));
  const visited = partial ? previous.filter((e) => fetchedIds.has(e.id)) : previous;
  const untouched = partial ? previous.filter((e) => !fetchedIds.has(e.id)) : [];

  const merged = mergeEntities<Exporter>([...visited], [...fetched], now, {
    contentFields: EXPORTER_SCALAR_FIELDS,
    titleOf: (exporter) => exporter.name,
  });

  const items = [...merged.items, ...untouched];
  return {
    items,
    changes: merged.changes,
    counts: {
      ...merged.counts,
      total: items.length,
      active: items.filter((e) => e.active).length,
      inactive: items.filter((e) => !e.active).length,
    },
  };
}

export async function ingestExportadores(
  options: IngestExportadoresOptions,
): Promise<IngestExportadoresResult> {
  const paths = options.paths ?? exportadoresPaths();
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const persist = options.persist !== false;
  const partial = options.partial === true;

  const { exporters, excluded, warnings } = toExporters(options.inputs, nowIso);
  const previous = await loadExporters(paths);
  const previousStatus = await loadExportadoresStatus(paths);

  const validation = validateExporters({
    exporters,
    directoryTotal: options.directoryTotal,
    excluded,
    previous: previousStatus,
    at: nowIso,
    partial,
  });

  const source = `${EXPORTADORES_SOURCE_NAME} (${EXPORTADORES_SOURCE_ID})`;
  const allWarnings = [...(options.warnings ?? []), ...warnings];

  if (validation.status === "fail") {
    const status: ExportadoresStatus = {
      last_run: nowIso,
      validation,
      counts: { ...emptyCounts(), total: previous.length, active: previous.length },
      source,
      content_hash: previousStatus?.content_hash ?? null,
      crawled_at: previousStatus?.crawled_at ?? null,
      directory_total: previousStatus?.directory_total ?? 0,
      directory_ids_hash: previousStatus?.directory_ids_hash ?? null,
      excluded_natural_persons: previousStatus?.excluded_natural_persons ?? 0,
      excluded_without_content: previousStatus?.excluded_without_content ?? 0,
      with_website: previousStatus?.with_website ?? 0,
    };
    if (persist) await saveExportadoresStatus(status, paths);
    return {
      validation,
      status,
      changes: [],
      warnings: allWarnings,
      excluded,
      persisted: false,
      rawFile: null,
    };
  }

  const merged = mergeExporters(previous, exporters, nowIso, partial);

  const status: ExportadoresStatus = {
    last_run: nowIso,
    validation,
    counts: merged.counts,
    source,
    content_hash: validation.content_hash ?? null,
    crawled_at: options.crawledAt ?? nowIso,
    directory_total: options.directoryTotal,
    directory_ids_hash:
      options.directoryIds === undefined
        ? (previousStatus?.directory_ids_hash ?? null)
        : directoryIdsHash(options.directoryIds),
    excluded_natural_persons: excluded.naturalPersons,
    excluded_without_content: excluded.withoutContent,
    with_website: merged.items.filter((e) => e.active && e.website !== null).length,
  };

  let rawFile: string | null = null;
  if (persist) {
    if (options.snapshot !== undefined) {
      rawFile = await saveCrawlSnapshot(options.snapshot, isoDate(todayInCordoba(now)), paths);
    }
    await saveExporters(merged.items, paths);
    await appendExportadoresChanges(merged.changes, paths);
    await saveExportadoresStatus(status, paths);
  }

  return {
    validation,
    status,
    changes: merged.changes,
    warnings: allWarnings,
    excluded,
    persisted: persist,
    rawFile,
  };
}

export interface ImportDirectorioOptions {
  paths?: ExportadoresPaths;
  now?: Date;
  persist?: boolean;
}

export async function importDirectorioFile(
  file: string,
  options: ImportDirectorioOptions = {},
): Promise<IngestExportadoresResult> {
  const payload = JSON.parse(await readFile(file, "utf8")) as unknown;
  const { inputs, crawledAt, directoryTotal } = readDirectorioFile(payload);
  return ingestExportadores({
    inputs,
    directoryTotal,
    directoryIds: inputs.map((input) => input.externalId),
    crawledAt,
    ...options,
  });
}
