import { HTTP_TIMEOUT_MS, USER_AGENT } from "../config.js";
import {
  CRAWL_DELAY_MS,
  CRAWL_JITTER_MS,
  CRAWL_RETRY_WAITS_MS,
  companyUrl,
  EXPORTADORES_SOURCE_URL,
} from "./config.js";
import type { ExporterInput } from "./normalize.js";
import { fichaToInput } from "./normalize.js";
import type { DirectoryListingEntry } from "./parse.js";
import { parseDirectoryListing, parseFicha } from "./parse.js";

export interface FetchedPage {
  ok: boolean;
  status: number;
  body: string;
}

export type PageFetcher = (url: string) => Promise<FetchedPage>;

export interface CrawlOptions {
  fetchPage?: PageFetcher;
  sleep?: (ms: number) => Promise<void>;
  delayMs?: number;
  limit?: number | undefined;
  ids?: readonly string[] | undefined;
  onProgress?: (done: number, total: number, label: string) => void;
}

export interface CrawlFailure {
  id: string;
  error: string;
}

export interface CrawlResult {
  entries: DirectoryListingEntry[];
  inputs: ExporterInput[];
  failed: CrawlFailure[];
  directoryTotal: number;
  directoryIds: string[];
  partial: boolean;
  warnings: string[];
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const defaultPageFetcher: PageFetcher = async (url) => {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html" },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  return {
    ok: response.ok,
    status: response.status,
    body: response.ok ? await response.text() : "",
  };
};

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

async function fetchWithRetries(
  url: string,
  fetchPage: PageFetcher,
  sleep: (ms: number) => Promise<void>,
): Promise<FetchedPage> {
  let last: FetchedPage = { ok: false, status: 0, body: "" };
  for (let attempt = 0; attempt <= CRAWL_RETRY_WAITS_MS.length; attempt++) {
    if (attempt > 0) await sleep(CRAWL_RETRY_WAITS_MS[attempt - 1] ?? 0);
    try {
      last = await fetchPage(url);
    } catch (err) {
      last = { ok: false, status: 0, body: err instanceof Error ? err.message : String(err) };
    }
    if (last.ok) return last;
    if (!RETRYABLE.has(last.status)) return last;
  }
  return last;
}

export async function fetchDirectoryListing(
  options: Pick<CrawlOptions, "fetchPage" | "sleep"> = {},
): Promise<DirectoryListingEntry[]> {
  const fetchPage = options.fetchPage ?? defaultPageFetcher;
  const sleep = options.sleep ?? wait;
  const page = await fetchWithRetries(EXPORTADORES_SOURCE_URL, fetchPage, sleep);
  if (!page.ok) {
    throw new Error(
      `no se pudo traer el listado (HTTP ${page.status}): ${EXPORTADORES_SOURCE_URL}`,
    );
  }
  const entries = parseDirectoryListing(page.body);
  if (entries.length === 0) {
    throw new Error("el listado no trajo ninguna tarjeta: el template del sitio cambió");
  }
  return entries;
}

export async function crawlDirectory(options: CrawlOptions = {}): Promise<CrawlResult> {
  const fetchPage = options.fetchPage ?? defaultPageFetcher;
  const sleep = options.sleep ?? wait;
  const delayMs = options.delayMs ?? CRAWL_DELAY_MS;

  const entries = await fetchDirectoryListing({ fetchPage, sleep });
  const directoryIds = entries.map((entry) => entry.externalId);

  const wanted =
    options.ids === undefined
      ? entries
      : entries.filter((e) => options.ids?.includes(e.externalId));
  const targets =
    options.limit === undefined ? wanted : wanted.slice(0, Math.max(0, options.limit));
  const partial = targets.length < entries.length;

  const inputs: ExporterInput[] = [];
  const failed: CrawlFailure[] = [];
  const warnings: string[] = [];

  for (const [index, entry] of targets.entries()) {
    if (index > 0) await sleep(delayMs + Math.floor(Math.random() * CRAWL_JITTER_MS));
    const page = await fetchWithRetries(companyUrl(entry.externalId), fetchPage, sleep);
    options.onProgress?.(index + 1, targets.length, entry.name);
    if (!page.ok) {
      failed.push({ id: entry.externalId, error: `HTTP ${page.status}` });
      continue;
    }
    const ficha = parseFicha(page.body, entry.externalId);
    if (ficha.withoutContent)
      warnings.push(`ficha sin contenido en la fuente: ${entry.externalId}`);
    inputs.push(fichaToInput(ficha, entry));
  }

  if (options.ids !== undefined) {
    for (const id of options.ids) {
      if (!directoryIds.includes(id)) warnings.push(`el id ${id} no está en el listado`);
    }
  }

  return {
    entries,
    inputs,
    failed,
    directoryTotal: entries.length,
    directoryIds,
    partial,
    warnings,
  };
}
