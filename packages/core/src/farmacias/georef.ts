/**
 * Geocoding con Georef (apis.datos.gob.ar), el servicio oficial de direcciones
 * normalizadas de Argentina. Es el proveedor primario porque:
 *   - acepta lotes (un POST resuelve 100 direcciones), así que una corrida
 *     completa son segundos y no horas;
 *   - no tiene rate limit publicado como el de Nominatim;
 *   - entiende la nomenclatura argentina ("RCA DE SIRIA", "BV GRL OCAMPO"),
 *     que es justo donde Nominatim falla con esta planilla.
 * Lo que no resuelve (calles informales, barrios cerrados) queda para Nominatim.
 */
import { HTTP_TIMEOUT_MS, USER_AGENT } from "../config.js";
import { expandAbbreviations, geocodeQuery, insideCordobaCoords } from "./geocode.js";
import type { GeocodePrecision } from "./models.js";
import { type GeocodeCache, type GeocodeEntry, geocodeKey } from "./normalize.js";

export const GEOREF_URL = "https://apis.datos.gob.ar/georef/api/direcciones";
/** Provincia de Córdoba (14) y departamento Capital (14014). */
export const GEOREF_PROVINCIA = "14";
export const GEOREF_DEPARTAMENTO = "14014";
/** Direcciones por request. El límite de la API es mucho mayor; vamos de a 100. */
export const GEOREF_BATCH = 100;

export interface GeorefAddress {
  nomenclatura?: string;
  altura?: { valor: number | null };
  ubicacion?: { lat: number; lon: number };
}

export interface GeorefTarget {
  address: string | null;
  barrio: string | null;
}

export class GeorefError extends Error {}

/** Las dos formas de preguntar por una dirección, de más a menos específica. */
export function georefQueries(target: GeorefTarget): string[] {
  if (!target.address) return [];
  const address = expandAbbreviations(geocodeQuery(target.address));
  if (address === "") return [];
  const queries = [address];
  // "República de Siria 602 General Bustos" -> "República de Siria 602":
  // cortar después del primer número saca el barrio pegado y los sufijos.
  const firstNumber = /^(.*?\D)(\d{1,6})\b/.exec(address);
  if (firstNumber) {
    const cut = `${firstNumber[1]!.trim()} ${firstNumber[2]!}`;
    if (cut !== address) queries.push(cut);
  }
  return queries;
}

export interface GeorefDeps {
  /** Inyectable para tests. Devuelve un resultado por consulta, en orden. */
  post?: (queries: string[]) => Promise<(GeorefAddress | null)[]>;
  onProgress?: (done: number, total: number) => void;
}

async function postGeoref(queries: string[]): Promise<(GeorefAddress | null)[]> {
  const body = {
    direcciones: queries.map((direccion) => ({
      direccion,
      provincia: GEOREF_PROVINCIA,
      departamento: GEOREF_DEPARTAMENTO,
      max: 1,
    })),
  };
  const res = await fetch(GEOREF_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": USER_AGENT },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) throw new GeorefError(`HTTP ${res.status} en Georef`);
  const payload = (await res.json()) as { resultados?: { direcciones?: GeorefAddress[] }[] };
  const results = payload.resultados ?? [];
  if (results.length !== queries.length) {
    throw new GeorefError(
      `Georef devolvió ${results.length} resultados para ${queries.length} consultas`,
    );
  }
  return results.map((result) => result.direcciones?.[0] ?? null);
}

export function toEntry(query: string, address: GeorefAddress, at: string): GeocodeEntry | null {
  const lat = address.ubicacion?.lat;
  const lon = address.ubicacion?.lon;
  if (lat === undefined || lon === undefined || !insideCordobaCoords(lat, lon)) return null;
  const precision: GeocodePrecision =
    address.altura?.valor === null || address.altura?.valor === undefined ? "calle" : "exacta";
  return {
    lat,
    lon,
    precision,
    label: address.nomenclatura ?? null,
    query,
    provider: "georef",
    at,
  };
}

export interface GeorefBatchResult {
  cache: GeocodeCache;
  resolved: number;
  pending: number;
  requests: number;
}

/**
 * Resuelve con Georef todo lo que falte en la cache, en lotes. Hace dos vueltas:
 * la dirección completa y, para lo que no salió, la dirección cortada en el
 * primer número.
 */
export async function geocodeWithGeoref(
  targets: GeorefTarget[],
  cache: GeocodeCache,
  deps: GeorefDeps = {},
): Promise<GeorefBatchResult> {
  const post = deps.post ?? postGeoref;
  const next: GeocodeCache = { ...cache };

  // Una entrada por clave, con sus consultas candidatas.
  const pending = new Map<string, { target: GeorefTarget; queries: string[] }>();
  for (const target of targets) {
    const key = geocodeKey(target);
    if (next[key]?.lat != null) continue;
    if (pending.has(key)) continue;
    const queries = georefQueries(target);
    if (queries.length === 0) continue;
    pending.set(key, { target, queries });
  }

  const at = new Date().toISOString();
  let resolved = 0;
  let requests = 0;
  const rounds = Math.max(0, ...[...pending.values()].map((p) => p.queries.length));

  for (let round = 0; round < rounds; round++) {
    const batch = [...pending.entries()]
      .filter(([, p]) => p.queries[round] !== undefined)
      .map(([key, p]) => ({ key, query: p.queries[round]! }));
    if (batch.length === 0) continue;

    for (let i = 0; i < batch.length; i += GEOREF_BATCH) {
      const slice = batch.slice(i, i + GEOREF_BATCH);
      const answers = await post(slice.map((item) => item.query));
      requests++;
      slice.forEach((item, index) => {
        const answer = answers[index];
        if (!answer) return;
        const entry = toEntry(item.query, answer, at);
        if (!entry) return;
        next[item.key] = entry;
        pending.delete(item.key);
        resolved++;
      });
      deps.onProgress?.(Math.min(i + GEOREF_BATCH, batch.length), batch.length);
    }
  }

  return { cache: next, resolved, pending: pending.size, requests };
}
