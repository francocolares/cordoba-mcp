/**
 * Geocoding de las direcciones de la planilla contra Nominatim (OSM).
 * Se corre una vez y la cache se commitea: es el artefacto caro del dataset.
 * La política de uso de Nominatim pide 1 request por segundo y un User-Agent
 * identificable, así que esto no corre nunca en el camino de una request.
 */
import { USER_AGENT } from "../config.js";
import { normalizeKey } from "../text.js";
import { GEOCODE_DELAY_MS, GEOCODE_RETRY_WAITS_MS, NOMINATIM_URL } from "./config.js";
import type { GeocodePrecision } from "./models.js";
import type { GeocodeCache, GeocodeEntry } from "./normalize.js";
import { geocodeKey } from "./normalize.js";

/** Caja de la ciudad y su corona (incluye Villa Allende, Guiñazú, Ferreyra). */
export const CORDOBA_VIEWBOX = { west: -64.45, north: -31.2, east: -63.95, south: -31.62 };

export interface NominatimPlace {
  lat: string;
  lon: string;
  display_name?: string;
  address?: { house_number?: string; road?: string };
}

export interface GeocodeTarget {
  address: string | null;
  barrio: string | null;
}

/** Limpia la dirección para el geocoder: local, manzana y esquina sólo molestan. */
export function geocodeQuery(address: string): string {
  return address
    .replace(/\b(?:loc(?:al)?\.?|l)\s*\.?\s*\d+[a-z]?\b/gi, " ")
    .replace(/\bl\s*\d+\s*y\s*\d+\b/gi, " ")
    .replace(/\b(?:mz|manzana|lote|lte|pb|piso|dpto|depto|of|oficina)\b[\s.]*\d*/gi, " ")
    .replace(/\besq\.?\s+.*$/i, " ")
    .replace(/\s*\/\s*\d+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Abreviaturas de la planilla. Nominatim tolera "Av." pero no "Rep. De Siria"
 * ni "Dnto Alvarez", que son las que hacen fallar la búsqueda.
 */
const ABBREVIATIONS: [RegExp, string][] = [
  [/\bav(?:da)?\.?\s/gi, "Avenida "],
  [/\bbv(?:d|ar)?\.?\s/gi, "Boulevard "],
  [/\bblvd\.?\s/gi, "Boulevard "],
  [/\bbvd\.?\s/gi, "Boulevard "],
  [/\bgral\.?\s/gi, "General "],
  [/\bcnel\.?\s/gi, "Coronel "],
  [/\brep\.?\s+de\s/gi, "República de "],
  [/\brep\.?\s/gi, "República "],
  [/\bpte\.?\s/gi, "Presidente "],
  [/\bpje\.?\s/gi, "Pasaje "],
  [/\bing\.?\s/gi, "Ingeniero "],
  [/\bdr\.?\s/gi, "Doctor "],
  [/\bmons\.?\s/gi, "Monseñor "],
  [/\bfco\.?\s/gi, "Francisco "],
  [/\bdnto\.?\s/gi, "Donato "],
  [/\bsgto\.?\s/gi, "Sargento "],
  [/\bcap\.?\s/gi, "Capitán "],
  [/\bprof\.?\s/gi, "Profesor "],
  [/\bhno\.?\s/gi, "Hermano "],
  [/\bnte\.?\s/gi, "Norte "],
  [/\bbv\.(?=\S)/gi, "Boulevard "],
  [/\bav\.(?=\S)/gi, "Avenida "],
];

export function expandAbbreviations(value: string): string {
  let out = ` ${value} `;
  for (const [pattern, replacement] of ABBREVIATIONS) out = out.replace(pattern, replacement);
  return out.replace(/\s{2,}/g, " ").trim();
}

const HAS_NUMBER = /\d/;
const FIRST_NUMBER = /^(.*?\D)(\d{1,6})\b/;

/** Variantes a probar, de la más específica a la menos. */
export function geocodeCandidates(
  target: GeocodeTarget,
): { query: string; precision: GeocodePrecision }[] {
  const out: { query: string; precision: GeocodePrecision }[] = [];
  const address = target.address ? expandAbbreviations(geocodeQuery(target.address)) : null;
  const barrio = target.barrio ? expandAbbreviations(target.barrio) : null;
  const push = (query: string, precision: GeocodePrecision) => {
    const clean = query.replace(/\s{2,}/g, " ").trim();
    if (clean === "" || out.some((c) => c.query === clean)) return;
    out.push({ query: clean, precision });
  };

  if (address && address !== "") {
    const exact: GeocodePrecision = HAS_NUMBER.test(address) ? "exacta" : "calle";
    if (barrio) push(`${address}, ${barrio}`, exact);
    push(address, exact);

    // "Rep. De Siria 602 Gral Bustos" -> "República de Siria 602" y "República de Siria":
    // cortar en el primer número saca el barrio pegado al final y los sufijos.
    const firstNumber = FIRST_NUMBER.exec(address);
    if (firstNumber) {
      push(`${firstNumber[1]!.trim()} ${firstNumber[2]!}`, "exacta");
      push(firstNumber[1]!.trim(), "calle");
    }
    const street = address.replace(/\s*\d+\s*$/, "").trim();
    if (street !== address) push(street, "calle");
  }
  if (barrio) push(`Barrio ${barrio}`, "barrio");
  return out;
}

export interface GeocodeDeps {
  /** Inyectable para tests y para cambiar de proveedor sin tocar la lógica. */
  search?: (query: string) => Promise<NominatimPlace[]>;
  sleep?: (ms: number) => Promise<void>;
  delayMs?: number;
  onProgress?: (done: number, total: number, label: string) => void;
  /** Se llama tras cada dirección resuelta: permite ir guardando la cache. */
  onEntry?: (cache: GeocodeCache, done: number, total: number) => void | Promise<void>;
}

const sleepDefault = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Nos están limitando: no es un error de la dirección, hay que frenar. */
export class ThrottledError extends Error {}

async function nominatim(query: string): Promise<NominatimPlace[]> {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", `${query}, Córdoba, Argentina`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "ar");
  url.searchParams.set(
    "viewbox",
    `${CORDOBA_VIEWBOX.west},${CORDOBA_VIEWBOX.north},${CORDOBA_VIEWBOX.east},${CORDOBA_VIEWBOX.south}`,
  );
  url.searchParams.set("bounded", "1");

  // Reintentos con espera creciente: en tandas largas Nominatim devuelve 503
  // aunque respetemos 1 request por segundo.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 429 || res.status === 503) {
      const wait = GEOCODE_RETRY_WAITS_MS[attempt];
      if (wait === undefined) {
        throw new ThrottledError(`Nominatim nos está limitando (HTTP ${res.status})`);
      }
      const retryAfter = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
      const ms = Number.isFinite(retryAfter) ? Math.max(wait, retryAfter * 1000) : wait;
      await new Promise((resolve) => setTimeout(resolve, ms));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} en Nominatim`);
    return (await res.json()) as NominatimPlace[];
  }
}

export function insideCordobaCoords(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat <= CORDOBA_VIEWBOX.north &&
    lat >= CORDOBA_VIEWBOX.south &&
    lon >= CORDOBA_VIEWBOX.west &&
    lon <= CORDOBA_VIEWBOX.east
  );
}

export function insideCordoba(place: NominatimPlace): boolean {
  return insideCordobaCoords(Number.parseFloat(place.lat), Number.parseFloat(place.lon));
}

export interface GeocodeOneResult extends GeocodeEntry {
  /** Requests gastados: lo usa el rate limiting del lote. */
  calls: number;
}

export async function geocodeOne(
  target: GeocodeTarget,
  deps: GeocodeDeps = {},
  at: string = new Date().toISOString(),
): Promise<GeocodeOneResult> {
  const search = deps.search ?? nominatim;
  const sleep = deps.sleep ?? sleepDefault;
  const delay = deps.delayMs ?? GEOCODE_DELAY_MS;
  const candidates = geocodeCandidates(target);
  let calls = 0;

  for (const candidate of candidates) {
    if (calls > 0) await sleep(delay);
    calls++;
    const places = await search(candidate.query);
    const place = places.find(insideCordoba);
    if (!place) continue;
    // Si pedimos altura y el geocoder no la resolvió, la precisión baja a calle.
    const precision: GeocodePrecision =
      candidate.precision === "exacta" && !place.address?.house_number
        ? "calle"
        : candidate.precision;
    return {
      lat: Number.parseFloat(place.lat),
      lon: Number.parseFloat(place.lon),
      precision,
      label: place.display_name ?? null,
      query: candidate.query,
      provider: "nominatim",
      at,
      calls,
    };
  }

  return {
    lat: null,
    lon: null,
    precision: "ninguna",
    label: null,
    query: candidates[0]?.query ?? "",
    provider: "nominatim",
    at,
    calls,
  };
}

export interface GeocodeBatchResult {
  /** Cache actualizada: hay que persistirla con `saveGeocodeCache`. */
  cache: GeocodeCache;
  resolved: number;
  failed: number;
  skipped: number;
  calls: number;
  /** true si cortamos porque nos limitaron: lo hecho sirve, hay que retomar. */
  aborted: boolean;
  abort_reason: string | null;
}

/**
 * Geocodifica lo que falta en la cache. Idempotente: lo ya resuelto no se vuelve
 * a pedir, así que se puede cortar y retomar (y `limit` permite hacerlo por tandas).
 */
export async function geocodeMissing(
  targets: GeocodeTarget[],
  cache: GeocodeCache,
  options: GeocodeDeps & { limit?: number; retryFailed?: boolean } = {},
): Promise<GeocodeBatchResult> {
  const sleep = options.sleep ?? sleepDefault;
  const delay = options.delayMs ?? GEOCODE_DELAY_MS;
  const next: GeocodeCache = { ...cache };
  const pending: GeocodeTarget[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (const target of targets) {
    const key = geocodeKey(target);
    if (key === "|" || normalizeKey(key) === "") continue;
    if (seen.has(key)) continue;
    seen.add(key);
    const hit = next[key];
    if (hit && (hit.lat !== null || !options.retryFailed)) {
      skipped++;
      continue;
    }
    pending.push(target);
  }

  const limit = options.limit ?? pending.length;
  const todo = pending.slice(0, Math.max(0, limit));
  let resolved = 0;
  let failed = 0;
  let calls = 0;
  let aborted = false;
  let abortReason: string | null = null;

  for (const [index, target] of todo.entries()) {
    if (calls > 0) await sleep(delay);
    let result: GeocodeOneResult;
    try {
      result = await geocodeOne(target, options);
    } catch (err) {
      // Cortamos la tanda: lo resuelto ya está en la cache y el próximo run sigue.
      aborted = true;
      abortReason = err instanceof Error ? err.message : String(err);
      break;
    }
    calls += result.calls;
    const { calls: _calls, ...entry } = result;
    next[geocodeKey(target)] = entry;
    if (entry.lat === null) failed++;
    else resolved++;
    options.onProgress?.(index + 1, todo.length, target.address ?? target.barrio ?? "");
    await options.onEntry?.(next, index + 1, todo.length);
  }

  return {
    cache: next,
    resolved,
    failed,
    skipped: skipped + (pending.length - todo.length),
    calls,
    aborted,
    abort_reason: abortReason,
  };
}
