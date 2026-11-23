import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { parseExportersJsonl } from "../jsonl.js";
import type { ChangeRecord } from "../models.js";
import type { ExportadoresStatus, Exporter } from "./models.js";

export interface ExportadoresPaths {
  root: string;
  dir: string;
  companies: string;
  changes: string;
  status: string;
  raw: string;
}

export function exportadoresPaths(root = "data"): ExportadoresPaths {
  const abs = resolve(root);
  const dir = join(abs, "exportadores");
  return {
    root: abs,
    dir,
    companies: join(dir, "companies.jsonl"),
    changes: join(dir, "changes.jsonl"),
    status: join(dir, "status.json"),
    raw: join(abs, "raw", "exportadores"),
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

export function serializeExporters(exporters: readonly Exporter[]): string {
  const sorted = [...exporters].sort(
    (a, b) => Number(a.id) - Number(b.id) || (a.id < b.id ? -1 : 1),
  );
  return `${sorted.map((e) => JSON.stringify(e)).join("\n")}\n`;
}

export async function loadExporters(
  paths: ExportadoresPaths = exportadoresPaths(),
): Promise<Exporter[]> {
  const text = await readIfExists(paths.companies);
  return text ? parseExportersJsonl(text) : [];
}

export async function saveExporters(
  exporters: readonly Exporter[],
  paths: ExportadoresPaths = exportadoresPaths(),
): Promise<void> {
  await mkdir(dirname(paths.companies), { recursive: true });
  await writeFile(paths.companies, serializeExporters(exporters), "utf8");
}

export async function appendExportadoresChanges(
  changes: readonly ChangeRecord[],
  paths: ExportadoresPaths = exportadoresPaths(),
): Promise<void> {
  if (changes.length === 0) return;
  await mkdir(dirname(paths.changes), { recursive: true });
  await appendFile(paths.changes, `${changes.map((c) => JSON.stringify(c)).join("\n")}\n`, "utf8");
}

export async function saveExportadoresStatus(
  status: ExportadoresStatus,
  paths: ExportadoresPaths = exportadoresPaths(),
): Promise<void> {
  await mkdir(dirname(paths.status), { recursive: true });
  await writeFile(paths.status, `${JSON.stringify(status, null, 2)}\n`, "utf8");
}

export async function loadExportadoresStatus(
  paths: ExportadoresPaths = exportadoresPaths(),
): Promise<ExportadoresStatus | null> {
  const text = await readIfExists(paths.status);
  return text ? (JSON.parse(text) as ExportadoresStatus) : null;
}

export async function saveCrawlSnapshot(
  payload: unknown,
  day: string,
  paths: ExportadoresPaths = exportadoresPaths(),
): Promise<string> {
  await mkdir(paths.raw, { recursive: true });
  const file = join(paths.raw, `${day}.json`);
  await writeFile(file, `${JSON.stringify(payload, null, 1)}\n`, "utf8");
  return file;
}

export { parseExportersJsonl };
