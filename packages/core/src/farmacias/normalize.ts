/** De filas parseadas de la planilla a entidades `Pharmacy`. */
import { sha1 } from "../normalize.js";
import { normalizeKey } from "../text.js";
import { FARMACIAS_SOURCE_ID } from "./config.js";
import { type GeocodePrecision, PHARMACY_CONTENT_FIELDS, type Pharmacy } from "./models.js";
import type { ParsedPharmacyRow } from "./parse.js";

export interface GeocodeEntry {
  lat: number | null;
  lon: number | null;
  precision: GeocodePrecision;
  label: string | null;
  /** La consulta que terminó resolviendo (o la primera que se intentó). */
  query: string;
  /** Qué servicio la resolvió: `georef` (oficial, por lotes) o `nominatim`. */
  provider?: "georef" | "nominatim";
  at: string;
}

export type GeocodeCache = Record<string, GeocodeEntry>;

/**
 * ID estable a partir de la celda completa normalizada. La celda es lo único
 * único en la planilla (los nombres se repiten: hay dos "LOS ANDES", dos
 * "ALVEAR"). Contra: si el Colegio corrige un typo en la dirección, la farmacia
 * aparece como baja + alta en changes.jsonl.
 */
export function pharmacyId(raw: string): string {
  return sha1(normalizeKey(raw)).slice(0, 12);
}

/** Clave de la cache de geocoding: dirección + barrio normalizados. */
export function geocodeKey(row: { address: string | null; barrio: string | null }): string {
  return normalizeKey(`${row.address ?? ""}|${row.barrio ?? ""}`);
}

export function pharmacyContentHash(
  pharmacy: Pick<Pharmacy, (typeof PHARMACY_CONTENT_FIELDS)[number]>,
): string {
  return sha1(
    PHARMACY_CONTENT_FIELDS.map((field) => `${field}=${String(pharmacy[field] ?? "")}`).join("\n"),
  );
}

export interface NormalizePharmaciesResult {
  pharmacies: Pharmacy[];
  warnings: string[];
}

export function toPharmacies(
  rows: ParsedPharmacyRow[],
  now: string,
  geocode: GeocodeCache = {},
): NormalizePharmaciesResult {
  const warnings: string[] = [];
  const seen = new Map<string, number>();
  const pharmacies: Pharmacy[] = [];

  for (const row of rows) {
    const baseId = pharmacyId(row.raw);
    const repeats = seen.get(baseId) ?? 0;
    seen.set(baseId, repeats + 1);
    if (repeats > 0) {
      warnings.push(
        `Fila repetida en la planilla (turno ${row.turno}, fila ${row.sheet_row}): ${row.raw}`,
      );
    }
    const id = repeats === 0 ? baseId : `${baseId}-${repeats + 1}`;
    const geo = geocode[geocodeKey(row)];

    const base = {
      turno: row.turno,
      section: row.section,
      name: row.name,
      address: row.address,
      barrio: row.barrio,
      raw: row.raw,
    };

    pharmacies.push({
      id,
      source: FARMACIAS_SOURCE_ID,
      ...base,
      parse_confidence: row.parse_confidence,
      lat: geo?.lat ?? null,
      lon: geo?.lon ?? null,
      geocode_precision: geo?.precision ?? "ninguna",
      geocode_label: geo?.label ?? null,
      active: true,
      first_seen: now,
      last_seen: now,
      content_hash: pharmacyContentHash(base),
    });
  }

  return { pharmacies, warnings };
}

/** Reaplica la cache de geocoding sobre el dataset ya persistido. */
export function applyGeocode(pharmacies: Pharmacy[], cache: GeocodeCache): Pharmacy[] {
  return pharmacies.map((pharmacy) => {
    const geo = cache[geocodeKey(pharmacy)];
    if (!geo) return pharmacy;
    return {
      ...pharmacy,
      lat: geo.lat,
      lon: geo.lon,
      geocode_precision: geo.precision,
      geocode_label: geo.label,
    };
  });
}
