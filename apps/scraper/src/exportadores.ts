import {
  crawlDirectory,
  directoryIdsHash,
  exportadoresPaths,
  fetchDirectoryListing,
  importDirectorioFile,
  ingestExportadores,
  loadExportadoresStatus,
} from "@cordoba/core";

export interface ExportadoresArgs {
  dataDir: string;
  file?: string | undefined;
  limit?: number | undefined;
  ids?: string[] | undefined;
}

const printJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

export async function runImport(args: ExportadoresArgs, persist: boolean): Promise<number> {
  if (args.file === undefined) {
    console.error("falta --file con el consolidado del directorio (empresas.json)");
    return 2;
  }
  const result = await importDirectorioFile(args.file, {
    paths: exportadoresPaths(args.dataDir),
    persist,
  });

  for (const warning of result.warnings.slice(0, 20)) console.error(`warn: ${warning}`);
  printJson({
    persisted: result.persisted,
    validation: result.validation,
    counts: result.status.counts,
    excluded: result.excluded,
    directory_total: result.status.directory_total,
    crawled_at: result.status.crawled_at,
    changes: result.changes.length,
    warnings: result.warnings.length,
  });

  if (result.validation.status === "fail") {
    console.error("La validación falló: no se persistió nada.");
    return 1;
  }
  return 0;
}

export async function runCheck(args: ExportadoresArgs): Promise<number> {
  const entries = await fetchDirectoryListing();
  const ids = entries.map((entry) => entry.externalId);
  const previous = await loadExportadoresStatus(exportadoresPaths(args.dataDir));
  const hash = directoryIdsHash(ids);
  const changed =
    previous?.directory_ids_hash !== null && previous?.directory_ids_hash !== undefined
      ? previous.directory_ids_hash !== hash
      : true;

  printJson({
    directory_total: entries.length,
    directory_ids_hash: hash,
    previous_total: previous?.directory_total ?? null,
    previous_ids_hash: previous?.directory_ids_hash ?? null,
    changed,
    delta: previous === null ? null : entries.length - previous.directory_total,
  });
  return 0;
}

export async function runCrawl(args: ExportadoresArgs, persist: boolean): Promise<number> {
  const started = Date.now();
  const crawl = await crawlDirectory({
    limit: args.limit,
    ids: args.ids,
    onProgress: (done, total, label) => {
      if (done % 25 === 0 || done === total) console.error(`ficha ${done}/${total} — ${label}`);
    },
  });

  const result = await ingestExportadores({
    inputs: crawl.inputs,
    directoryTotal: crawl.directoryTotal,
    directoryIds: crawl.directoryIds,
    partial: crawl.partial,
    unvisited: crawl.failed.map((failure) => failure.id),
    warnings: crawl.warnings,
    paths: exportadoresPaths(args.dataDir),
    persist,
    snapshot: {
      crawled_at: new Date().toISOString(),
      directory_total: crawl.directoryTotal,
      failed: crawl.failed,
      fichas: crawl.inputs,
    },
  });

  for (const warning of result.warnings.slice(0, 20)) console.error(`warn: ${warning}`);
  printJson({
    persisted: result.persisted,
    partial: crawl.partial,
    fetched: crawl.inputs.length,
    failed: crawl.failed,
    directory_total: crawl.directoryTotal,
    validation: result.validation,
    counts: result.status.counts,
    excluded: result.excluded,
    changes: result.changes.length,
    raw_file: result.rawFile,
    minutes: Math.round((Date.now() - started) / 60_000),
  });

  if (result.validation.status === "fail") {
    console.error("La validación falló: no se persistió nada.");
    return 1;
  }
  return crawl.failed.length > 0 ? 1 : 0;
}
