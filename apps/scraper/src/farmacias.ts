/** Subcomandos `farmacias` del CLI: ingest, validate y geocode. */
import { access } from "node:fs/promises";

import {
  applyGeocode,
  farmaciasPaths,
  geocodeMissing,
  geocodeWithGeoref,
  ingestFarmacias,
  loadFarmaciasStatus,
  loadGeocodeCache,
  loadPharmacies,
  saveFarmaciasStatus,
  saveGeocodeCache,
  savePharmacies,
  turneroUrl,
} from "@cordoba/core";

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

export interface FarmaciasArgs {
  dataDir: string;
  file?: string | undefined;
  url?: string | undefined;
  year?: number | undefined;
  limit?: number | undefined;
  download: boolean;
  retryFailed: boolean;
  skipGeoref: boolean;
  skipNominatim: boolean;
}

const printJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

/**
 * De dónde sale el .xlsx. Por defecto, el snapshot commiteado: el turnero es un
 * archivo que circula por Drive y no queremos que el build dependa de ese link.
 */
async function resolveSource(
  args: FarmaciasArgs,
): Promise<{ file?: string; url?: string; origin: string }> {
  if (args.file) return { file: args.file, origin: args.file };
  if (args.url) return { url: args.url, origin: args.url };
  if (!args.download) {
    const paths = farmaciasPaths(args.dataDir);
    const year = args.year ?? new Date().getFullYear();
    for (const candidate of [year, year + 1]) {
      const file = `${paths.raw}/turnero-${candidate}.xlsx`;
      if (await exists(file)) return { file, origin: file };
    }
  }
  return { url: turneroUrl(), origin: turneroUrl() };
}

export async function runIngest(args: FarmaciasArgs, persist: boolean): Promise<number> {
  const paths = farmaciasPaths(args.dataDir);
  const source = await resolveSource(args);
  console.error(`fuente: ${source.origin}`);

  const result = await ingestFarmacias({
    file: source.file,
    url: source.url,
    paths,
    expectedYear: args.year,
    persist,
  });

  for (const warning of result.warnings) console.error(`warn: ${warning}`);
  printJson({
    year: result.year,
    persisted: result.persisted,
    validation: result.validation,
    counts: result.status.counts,
    geocoded: result.status.geocoded,
    pending_geocode: result.status.pending_geocode,
    raw_file: result.rawFile,
    changes: result.changes.length,
  });

  if (result.validation.status === "fail") {
    console.error("La validación falló: no se persistió nada.");
    return 1;
  }
  return 0;
}

export async function runGeocode(args: FarmaciasArgs): Promise<number> {
  const paths = farmaciasPaths(args.dataDir);
  const pharmacies = await loadPharmacies(paths);
  if (pharmacies.length === 0) {
    console.error("No hay farmacias cargadas: corré primero `farmacias ingest`.");
    return 1;
  }
  let cache = await loadGeocodeCache(paths);
  const targets = pharmacies
    .filter((p) => p.active)
    .map((p) => ({ address: p.address, barrio: p.barrio }));

  // Primera pasada: Georef, oficial y por lotes. Resuelve la mayoría en segundos.
  let georef = { resolved: 0, pending: 0, requests: 0 };
  if (!args.skipGeoref) {
    const result = await geocodeWithGeoref(targets, cache, {
      onProgress: (done, pending) => console.error(`georef ${done}/${pending}`),
    });
    cache = result.cache;
    georef = { resolved: result.resolved, pending: result.pending, requests: result.requests };
    await saveGeocodeCache(cache, paths);
    console.error(
      `georef: ${result.resolved} resueltas en ${result.requests} request(s), ` +
        `${result.pending} sin resolver`,
    );
  }

  const total = targets.length;
  // Segunda pasada: Nominatim, a 1 request por segundo, sólo para lo que falta
  // (incluye el fallback por barrio, que Georef no cubre).
  const result = args.skipNominatim
    ? { cache, resolved: 0, failed: 0, skipped: 0, calls: 0, aborted: false, abort_reason: null }
    : await geocodeMissing(targets, cache, {
        limit: args.limit,
        retryFailed: args.retryFailed,
        onProgress: (done, pending, label) => {
          if (done % 25 === 0 || done === pending) {
            console.error(`geocoding ${done}/${pending} (de ${total} direcciones) — ${label}`);
          }
        },
        // Guardado incremental: son ~20 minutos de requests, así que si se corta
        // (o nos limitan) lo hecho queda en la cache y el próximo run retoma.
        onEntry: async (partial, done, pending) => {
          if (done % 25 === 0 || done === pending) await saveGeocodeCache(partial, paths);
        },
      });

  await saveGeocodeCache(result.cache, paths);
  const updated = applyGeocode(pharmacies, result.cache);
  await savePharmacies(updated, paths);

  const status = await loadFarmaciasStatus(paths);
  if (status) {
    await saveFarmaciasStatus(
      {
        ...status,
        geocoded: updated.filter((p) => p.lat !== null).length,
        pending_geocode: updated.filter((p) => p.lat === null && p.active).length,
      },
      paths,
    );
  }

  const pending = updated.filter((p) => p.lat === null && p.active).length;
  printJson({
    georef,
    resolved: result.resolved,
    failed: result.failed,
    skipped: result.skipped,
    requests: result.calls,
    aborted: result.aborted,
    abort_reason: result.abort_reason,
    geocoded_total: updated.filter((p) => p.lat !== null).length,
    pending,
  });

  if (result.aborted) {
    console.error(
      `La tanda se cortó (${result.abort_reason ?? "sin detalle"}). ` +
        `Quedaron ${pending} direcciones: volvé a correr el comando para retomar.`,
    );
    return 1;
  }
  return 0;
}
