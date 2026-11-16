/** Consultas sobre el dataset de farmacias. Puro: sirve igual en el Worker. */
import {
  addDays,
  type CalendarDate,
  cordobaParts,
  isoDate,
  parseDate,
  resolveDateInput,
  toIso,
} from "../datetime.js";
import { normalizeKey } from "../text.js";
import { TURNO_DURATION_HOURS, TURNO_START } from "./config.js";
import type { Pharmacy, TurnoCalendar } from "./models.js";

export interface TurnoLookup {
  date: string;
  turno: number;
  /** true si lo calculamos con el ciclo porque la fecha no está en la planilla. */
  derived: boolean;
  year: number;
}

const byDate = (calendars: TurnoCalendar[], year: number): TurnoCalendar | null =>
  calendars.find((c) => c.year === year) ?? null;

/** Turno de una fecha: primero la planilla, y si no está, el ciclo de 30 días. */
export function turnoOn(calendars: TurnoCalendar[], date: CalendarDate): TurnoLookup | null {
  const iso = isoDate(date);
  const exact = byDate(calendars, date.year);
  const fromSheet = exact?.days[iso];
  if (fromSheet !== undefined) {
    return { date: iso, turno: fromSheet, derived: false, year: date.year };
  }

  // Sin calendario del año: proyectamos desde el ancla más reciente.
  const anchored = [...calendars].sort((a, b) => b.year - a.year)[0];
  if (!anchored) return null;
  const turno = turnoByCycle(anchored, date);
  return turno === null ? null : { date: iso, turno, derived: true, year: anchored.year };
}

/** Turno proyectado con el ciclo (`anchor` + N días). */
export function turnoByCycle(calendar: TurnoCalendar, date: CalendarDate): number | null {
  const anchor = parseDate(calendar.anchor.date);
  if (!anchor) return null;
  const cycle = calendar.cycle_length;
  const days = Math.round(
    (Date.UTC(date.year, date.month - 1, date.day) -
      Date.UTC(anchor.year, anchor.month - 1, anchor.day)) /
      86_400_000,
  );
  const offset = (((calendar.anchor.turno - 1 + days) % cycle) + cycle) % cycle;
  return offset + 1;
}

export interface TurnoWindow {
  /** Día de guardia (el turno que arranca ese día). */
  service_date: string;
  from: string;
  to: string;
  start_time: string;
  duration_hours: number;
}

const HHMM = /^(\d{1,2}):(\d{2})$/;

function startClock(): { hour: number; minute: number } {
  const match = HHMM.exec(TURNO_START);
  if (!match) return { hour: 8, minute: 30 };
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/** Ventana de guardia de un día: de `TURNO_START` a `TURNO_START` + duración. */
export function turnoWindow(date: CalendarDate): TurnoWindow {
  const start = startClock();
  const from = toIso(date, start);
  const endInstant = new Date(Date.parse(from) + TURNO_DURATION_HOURS * 3_600_000);
  const parts = cordobaParts(endInstant);
  const to = toIso(
    { year: parts.year, month: parts.month, day: parts.day },
    { hour: parts.hour, minute: parts.minute },
  );
  return {
    service_date: isoDate(date),
    from,
    to,
    start_time: `${String(start.hour).padStart(2, "0")}:${String(start.minute).padStart(2, "0")}`,
    duration_hours: TURNO_DURATION_HOURS,
  };
}

/**
 * Qué día de guardia corresponde a un instante. Clave: si la guardia arranca a
 * las 08:30, a las 02:00 del martes sigue de turno la farmacia del lunes.
 */
export function serviceDateAt(now: Date = new Date()): CalendarDate {
  const parts = cordobaParts(now);
  const today = { year: parts.year, month: parts.month, day: parts.day };
  const start = startClock();
  const beforeStart =
    parts.hour < start.hour || (parts.hour === start.hour && parts.minute < start.minute);
  return beforeStart ? addDays(today, -1) : today;
}

/** `"ahora"` | `"hoy"` | `"mañana"` | `aaaa-mm-dd`. */
export function resolveServiceDate(
  input: string | undefined,
  now: Date = new Date(),
): CalendarDate | null {
  if (input === undefined || normalizeKey(input) === "ahora" || normalizeKey(input) === "now") {
    return serviceDateAt(now);
  }
  return resolveDateInput(input, now);
}

/* ---------------------------------------------------------------- listas -- */

export const EARTH_RADIUS_KM = 6371;

export function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface PharmacySummary {
  id: string;
  name: string | null;
  address: string | null;
  barrio: string | null;
  section: number | null;
  turno: number;
  lat: number | null;
  lon: number | null;
  geocode_precision: string;
  raw: string;
  distance_km?: number;
}

export function toPharmacySummary(pharmacy: Pharmacy, distanceKm?: number): PharmacySummary {
  return {
    id: pharmacy.id,
    name: pharmacy.name,
    address: pharmacy.address,
    barrio: pharmacy.barrio,
    section: pharmacy.section,
    turno: pharmacy.turno,
    lat: pharmacy.lat,
    lon: pharmacy.lon,
    geocode_precision: pharmacy.geocode_precision,
    raw: pharmacy.raw,
    ...(distanceKm === undefined ? {} : { distance_km: Math.round(distanceKm * 100) / 100 }),
  };
}

const bySection = (a: Pharmacy, b: Pharmacy) =>
  (a.section ?? 99) - (b.section ?? 99) ||
  normalizeKey(a.name ?? a.raw).localeCompare(normalizeKey(b.name ?? b.raw));

export function pharmaciesOfTurno(pharmacies: Pharmacy[], turno: number): Pharmacy[] {
  return pharmacies.filter((p) => p.active && p.turno === turno).sort(bySection);
}

export function matchesBarrio(pharmacy: Pharmacy, barrio: string): boolean {
  const needle = normalizeKey(barrio);
  if (needle === "") return true;
  return normalizeKey(`${pharmacy.barrio ?? ""} ${pharmacy.address ?? ""}`).includes(needle);
}

export interface NearParams {
  lat: number;
  lon: number;
  radius_km?: number;
  limit?: number;
}

/** Ordena por distancia. Las que no están geocodificadas quedan afuera. */
export function nearest(
  pharmacies: Pharmacy[],
  params: NearParams,
): { pharmacy: Pharmacy; distance_km: number }[] {
  const origin = { lat: params.lat, lon: params.lon };
  const radius = params.radius_km ?? Number.POSITIVE_INFINITY;
  return pharmacies
    .filter((p) => p.lat !== null && p.lon !== null)
    .map((p) => ({ pharmacy: p, distance_km: haversineKm(origin, { lat: p.lat!, lon: p.lon! }) }))
    .filter((row) => row.distance_km <= radius)
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, Math.max(0, params.limit ?? 10));
}

export function findPharmacies(pharmacies: Pharmacy[], query: string, limit = 10): Pharmacy[] {
  const needle = normalizeKey(query);
  if (needle === "") return [];
  const tokens = needle.split(" ");
  return pharmacies
    .filter((p) => {
      const hay = normalizeKey(
        [p.name, p.address, p.barrio, p.raw].filter((part) => part !== null).join(" "),
      );
      return tokens.every((token) => hay.includes(token));
    })
    .sort((a, b) => normalizeKey(a.name ?? a.raw).localeCompare(normalizeKey(b.name ?? b.raw)))
    .slice(0, Math.max(0, limit));
}

export interface DutyDate {
  date: string;
  /** true si la fecha sale del ciclo proyectado y no de un turnero cargado. */
  derived: boolean;
}

/** Próximas fechas en que le toca guardia a un turno. */
export function nextDutyDates(
  calendars: TurnoCalendar[],
  turno: number,
  from: CalendarDate,
  count = 3,
): DutyDate[] {
  const out: DutyDate[] = [];
  let cursor = from;
  // 30 días de ciclo: en 2 vueltas (más el salto de año) ya están las próximas.
  for (let i = 0; i < 400 && out.length < count; i++) {
    const lookup = turnoOn(calendars, cursor);
    if (lookup?.turno === turno) out.push({ date: isoDate(cursor), derived: lookup.derived });
    cursor = addDays(cursor, 1);
  }
  return out;
}

export function getPharmacy(pharmacies: Pharmacy[], id: string): Pharmacy | null {
  return pharmacies.find((p) => p.id === id) ?? null;
}
