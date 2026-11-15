import { TZ_OFFSET, TZ_OFFSET_MINUTES } from "./config.js";

export interface CalendarDate {
  year: number;
  month: number; // 1-12
  day: number;
}

export interface Clock {
  hour: number;
  minute: number;
}

const DMY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;
/** `Date(y,m,d)` con mes base 0. */
const GVIZ_DATE = /^Date\((\d{4}),\s*(\d{1,2}),\s*(\d{1,2})/;
const HM = /(\d{1,2}):(\d{2})/;
/** Las horas vienen como `Date(1899,11,30,20,0,0)`. */
const GVIZ_TIME = /^Date\(\d{4},\s*\d{1,2},\s*\d{1,2},\s*(\d{1,2}),\s*(\d{1,2})/;

/** Acepta `dd/mm/aaaa`, `aaaa-mm-dd` y `Date(y,m,d)` (mes base 0). */
export function parseDate(value: unknown): CalendarDate | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === "") return null;

  const gviz = GVIZ_DATE.exec(text);
  if (gviz) {
    return { year: +gviz[1]!, month: +gviz[2]! + 1, day: +gviz[3]! };
  }
  const dmy = DMY.exec(text);
  if (dmy) {
    return { year: +dmy[3]!, month: +dmy[2]!, day: +dmy[1]! };
  }
  const iso = ISO_DATE.exec(text);
  if (iso) {
    return { year: +iso[1]!, month: +iso[2]!, day: +iso[3]! };
  }
  return null;
}

/** Acepta `HH:mm` y `Date(1899,11,30,H,M,S)`. */
export function parseTime(value: unknown): Clock | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === "") return null;

  const gviz = GVIZ_TIME.exec(text);
  if (gviz) return { hour: +gviz[1]!, minute: +gviz[2]! };

  const hm = HM.exec(text);
  if (hm) {
    const hour = +hm[1]!;
    const minute = +hm[2]!;
    if (hour > 23 || minute > 59) return null;
    return { hour, minute };
  }
  return null;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

export function isoDate(d: CalendarDate): string {
  return `${pad(d.year, 4)}-${pad(d.month)}-${pad(d.day)}`;
}

/** ISO 8601 con el offset fijo de Córdoba. */
export function toIso(d: CalendarDate, t: Clock = { hour: 0, minute: 0 }): string {
  return `${isoDate(d)}T${pad(t.hour)}:${pad(t.minute)}:00${TZ_OFFSET}`;
}

export function addDays(d: CalendarDate, days: number): CalendarDate {
  const utc = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
}

export function compareDates(a: CalendarDate, b: CalendarDate): number {
  return isoDate(a) < isoDate(b) ? -1 : isoDate(a) > isoDate(b) ? 1 : 0;
}

/** Partes de la fecha/hora de un instante, en hora de Córdoba. */
export function cordobaParts(instant: Date): CalendarDate & Clock & { weekday: number } {
  const shifted = new Date(instant.getTime() + TZ_OFFSET_MINUTES * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(), // 0 = domingo
  };
}

/** Fecha de hoy en Córdoba. */
export function todayInCordoba(now: Date = new Date()): CalendarDate {
  const p = cordobaParts(now);
  return { year: p.year, month: p.month, day: p.day };
}

/** `hoy` | `mañana` | `ayer` | ISO `aaaa-mm-dd` | `dd/mm/aaaa`. */
export function resolveDateInput(input: string, now: Date = new Date()): CalendarDate | null {
  const key = input
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
  const today = todayInCordoba(now);
  if (key === "hoy" || key === "today") return today;
  if (key === "manana" || key === "tomorrow") return addDays(today, 1);
  if (key === "ayer" || key === "yesterday") return addDays(today, -1);
  return parseDate(input);
}

/**
 * Próximo fin de semana: desde el viernes 18:00 hasta el domingo 23:59.
 * Si hoy ya es sábado o domingo, devuelve el fin de semana en curso.
 */
export function weekendRange(now: Date = new Date()): { from: string; to: string } {
  const p = cordobaParts(now);
  const today = { year: p.year, month: p.month, day: p.day };
  // weekday: 0 dom, 5 vie, 6 sab
  let offsetToFriday: number;
  if (p.weekday === 6) offsetToFriday = -1;
  else if (p.weekday === 0) offsetToFriday = -2;
  else offsetToFriday = 5 - p.weekday;
  const friday = addDays(today, offsetToFriday);
  const sunday = addDays(friday, 2);
  return {
    from: toIso(friday, { hour: 18, minute: 0 }),
    to: toIso(sunday, { hour: 23, minute: 59 }),
  };
}
