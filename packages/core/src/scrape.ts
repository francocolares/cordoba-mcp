import { AGENDA_URL, SOURCE_ID } from "./config.js";
import { isoDate, todayInCordoba } from "./datetime.js";
import type { RunStatus, ValidationResult } from "./models.js";
import type { Source } from "./sources/base.js";
import { TurismoMuniSource } from "./sources/turismoMuni.js";
import {
  appendChanges,
  dataPaths,
  loadEvents,
  merge,
  type Paths,
  saveEvents,
  saveRaw,
  saveStatus,
  schemaHash,
} from "./store.js";

export interface ScrapeOptions {
  paths?: Paths;
  source?: Source;
  now?: Date;
  validation?: ValidationResult | null;
}

export interface ScrapeResult {
  status: RunStatus;
  warnings: string[];
  rawFile: string;
}

export async function scrape(options: ScrapeOptions = {}): Promise<ScrapeResult> {
  const paths = options.paths ?? dataPaths();
  const source = options.source ?? new TurismoMuniSource();
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();

  const fetched = await source.fetch(nowIso);
  const previous = await loadEvents(paths);
  const { events, changes, counts } = merge(previous, fetched.events, nowIso);

  const rawFile = await saveRaw(fetched.raw, isoDate(todayInCordoba(now)), paths);
  await saveEvents(events, paths);
  await appendChanges(changes, paths);

  const status: RunStatus = {
    last_run: nowIso,
    validation: options.validation ?? null,
    scraped: true,
    counts,
    source: `${source.name} (${SOURCE_ID}) – ${AGENDA_URL}`,
    schema_hash: schemaHash(fetched.columns),
    bundle_hash: options.validation?.bundle_hash ?? null,
  };
  await saveStatus(status, paths);

  return { status, warnings: fetched.warnings, rawFile };
}
