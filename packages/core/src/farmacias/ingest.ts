/**
 * Ingesta del turnero: .xlsx -> `data/farmacias/`. Se corre una vez por año
 * (o cuando el Colegio corrige la planilla), no en el cron diario.
 */
import { readFile } from "node:fs/promises";

import { HTTP_TIMEOUT_MS, USER_AGENT } from "../config.js";
import type { ChangeRecord, Counts, ValidationResult } from "../models.js";
import { mergeEntities } from "../store.js";
import {
  FARMACIAS_SOURCE_ID,
  FARMACIAS_SOURCE_NAME,
  TURNERO_FILE_ID,
  TURNO_CYCLE_LENGTH,
  turneroUrl,
} from "./config.js";
import {
  type FarmaciasStatus,
  PHARMACY_CONTENT_FIELDS,
  type Pharmacy,
  type TurnoCalendar,
} from "./models.js";
import { toPharmacies } from "./normalize.js";
import { parseWorkbook } from "./parse.js";
import {
  appendFarmaciasChanges,
  type FarmaciasPaths,
  farmaciasPaths,
  loadCalendars,
  loadGeocodeCache,
  loadPharmacies,
  saveCalendars,
  saveFarmaciasStatus,
  savePharmacies,
  saveTurneroFile,
} from "./store.js";
import { validateWorkbook } from "./validate.js";
import { readXlsx } from "./xlsx.js";

export interface IngestOptions {
  /** Path al .xlsx. Si no está, se baja de `url`. */
  file?: string | undefined;
  url?: string | undefined;
  paths?: FarmaciasPaths;
  now?: Date;
  expectedYear?: number | undefined;
  /** false = corre todo y reporta, pero no escribe (modo validación). */
  persist?: boolean;
}

export interface IngestResult {
  validation: ValidationResult;
  status: FarmaciasStatus;
  changes: ChangeRecord[];
  warnings: string[];
  persisted: boolean;
  rawFile: string | null;
  year: number | null;
}

async function loadBuffer(options: IngestOptions): Promise<Buffer> {
  if (options.file) return readFile(options.file);
  const url = options.url ?? turneroUrl(TURNERO_FILE_ID);
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} al bajar el turnero (${url})`);
  return Buffer.from(await res.arrayBuffer());
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

export async function ingestFarmacias(options: IngestOptions = {}): Promise<IngestResult> {
  const paths = options.paths ?? farmaciasPaths();
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const persist = options.persist !== false;

  const buffer = await loadBuffer(options);
  const workbook = parseWorkbook(readXlsx(buffer));
  const validation = validateWorkbook(workbook, {
    at: nowIso,
    expectedYear: options.expectedYear,
  });

  const previousPharmacies = await loadPharmacies(paths);
  const previousCalendars = await loadCalendars(paths);

  if (validation.status === "fail") {
    const status: FarmaciasStatus = {
      last_run: nowIso,
      validation,
      counts: { ...emptyCounts(), total: previousPharmacies.length },
      years: previousCalendars.map((c) => c.year),
      geocoded: previousPharmacies.filter((p) => p.lat !== null).length,
      pending_geocode: previousPharmacies.filter((p) => p.lat === null).length,
      source: `${FARMACIAS_SOURCE_NAME} (${FARMACIAS_SOURCE_ID})`,
      content_hash: validation.content_hash ?? null,
    };
    if (persist) await saveFarmaciasStatus(status, paths);
    return {
      validation,
      status,
      changes: [],
      warnings: workbook.warnings,
      persisted: false,
      rawFile: null,
      year: workbook.year,
    };
  }

  const geocode = await loadGeocodeCache(paths);
  const { pharmacies, warnings } = toPharmacies(workbook.rows, nowIso, geocode);
  const merged = mergeEntities<Pharmacy>(previousPharmacies, pharmacies, nowIso, {
    contentFields: PHARMACY_CONTENT_FIELDS,
    titleOf: (pharmacy) => pharmacy.name ?? pharmacy.raw,
  });

  const dates = Object.keys(workbook.days).sort();
  const firstDate = dates[0]!;
  const calendar: TurnoCalendar = {
    year: workbook.year,
    cycle_length: TURNO_CYCLE_LENGTH,
    anchor: { date: firstDate, turno: workbook.days[firstDate]! },
    days: Object.fromEntries(dates.map((date) => [date, workbook.days[date]!])),
    source_file: `data/raw/farmacias/turnero-${workbook.year}.xlsx`,
    content_hash: validation.content_hash ?? "",
    ingested_at: nowIso,
  };
  const calendars = [...previousCalendars.filter((c) => c.year !== calendar.year), calendar].sort(
    (a, b) => a.year - b.year,
  );

  const status: FarmaciasStatus = {
    last_run: nowIso,
    validation,
    counts: merged.counts,
    years: calendars.map((c) => c.year),
    geocoded: merged.items.filter((p) => p.lat !== null).length,
    pending_geocode: merged.items.filter((p) => p.lat === null && p.active).length,
    source: `${FARMACIAS_SOURCE_NAME} (${FARMACIAS_SOURCE_ID})`,
    content_hash: validation.content_hash ?? null,
  };

  let rawFile: string | null = null;
  if (persist) {
    rawFile = await saveTurneroFile(buffer, workbook.year, paths);
    await savePharmacies(merged.items, paths);
    await saveCalendars(calendars, paths);
    await appendFarmaciasChanges(merged.changes, paths);
    await saveFarmaciasStatus(status, paths);
  }

  return {
    validation,
    status,
    changes: merged.changes,
    warnings: [...workbook.warnings, ...warnings],
    persisted: persist,
    rawFile,
    year: workbook.year,
  };
}
