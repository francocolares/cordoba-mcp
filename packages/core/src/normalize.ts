import { createHash } from "node:crypto";
import { classify } from "./categories.js";
import { SOURCE_ID } from "./config.js";
import type { CalendarDate, Clock } from "./datetime.js";
import { addDays, compareDates, parseDate, parseTime, toIso } from "./datetime.js";
import type { GvizRow } from "./gviz.js";
import { CONTENT_FIELDS, type Event, type PriceType } from "./models.js";
import { normalizeKey } from "./text.js";

export function sha1(value: string): string {
  return createHash("sha1").update(value, "utf8").digest("hex");
}

/** ID propio estable: no dependemos del índice de fila, que se corre. */
export function eventId(title: string, startIso: string, venue: string | null): string {
  const key = `${normalizeKey(title)}|${startIso.slice(0, 10)}|${normalizeKey(venue)}`;
  return sha1(key).slice(0, 12);
}

export function contentHash(event: Pick<Event, (typeof CONTENT_FIELDS)[number]>): string {
  const payload = CONTENT_FIELDS.map((f) => `${f}=${String(event[f] ?? "")}`).join("\n");
  return sha1(payload);
}

export function priceType(priceRaw: string | null, ticketUrl: string | null): PriceType {
  const raw = normalizeKey(priceRaw);
  if (raw === "0" || raw === "$0" || /gratis|libre|sin cargo|gratuit/.test(raw)) return "gratis";
  if (raw !== "" || ticketUrl) return "pago";
  return "desconocido";
}

function cleanText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.replace(/\r\n/g, "\n").trim();
  return trimmed === "" ? null : trimmed;
}

function isTruthyFlag(value: string | null): boolean {
  const raw = normalizeKey(value);
  return raw === "1" || raw === "si" || raw === "true" || raw === "x";
}

function pickDate(row: GvizRow, column: string): CalendarDate | null {
  return parseDate(row.values[column]) ?? parseDate(row.raw[column]);
}

function pickTime(row: GvizRow, column: string): Clock | null {
  return parseTime(row.values[column]) ?? parseTime(row.raw[column]);
}

export interface NormalizeResult {
  event: Event | null;
  warnings: string[];
}

/** Convierte una fila de la planilla en un Event canónico. */
export function normalizeRow(row: GvizRow, now: string): NormalizeResult {
  const warnings: string[] = [];
  const title = cleanText(row.values["Nombre"]);
  const startDate = pickDate(row, "fecha_ini");

  if (!title) {
    warnings.push(`fila ${row.index}: sin Nombre, se descarta`);
    return { event: null, warnings };
  }
  if (!startDate) {
    warnings.push(
      `fila ${row.index}: fecha_ini ilegible (${row.values["fecha_ini"]}), se descarta`,
    );
    return { event: null, warnings };
  }

  const startTime = pickTime(row, "Hora");
  const allDay = startTime === null;
  const start = toIso(startDate, startTime ?? { hour: 0, minute: 0 });

  const endTime = pickTime(row, "Hora_fin");
  let endDate = pickDate(row, "Fecha_fin");
  if (!endDate && endTime) endDate = startDate;
  let end: string | null = null;
  if (endDate) {
    let effectiveEnd = endDate;
    // Shows que cruzan la medianoche: misma fecha y hora de fin menor que la de inicio.
    if (
      endTime &&
      startTime &&
      compareDates(endDate, startDate) === 0 &&
      (endTime.hour < startTime.hour ||
        (endTime.hour === startTime.hour && endTime.minute < startTime.minute))
    ) {
      effectiveEnd = addDays(endDate, 1);
    }
    end = toIso(effectiveEnd, endTime ?? { hour: 23, minute: 59 });
  }

  const categoryRaw = cleanText(row.values["Tipo de Evento"]);
  const match = classify(categoryRaw);
  if (categoryRaw && !match.matched) {
    warnings.push(`fila ${row.index}: Tipo de Evento sin mapeo -> "otro" ("${categoryRaw}")`);
  }

  const venue = cleanText(row.values["Lugar"]);
  const ticketUrl = cleanText(row.values["Inscripción"]);
  const priceRaw = cleanText(row.values["Precio"]);

  const base = {
    title,
    description: cleanText(row.values["Descripción"]),
    category_raw: categoryRaw,
    category: match.category,
    start,
    end,
    all_day: allDay,
    venue,
    organizer: cleanText(row.values["Organizador"]),
    ticket_url: ticketUrl,
    price_type: priceType(priceRaw, ticketUrl),
    price_raw: priceRaw,
    is_permanent: isTruthyFlag(row.values["Permanente"] ?? null),
    permanent_schedule: cleanText(row.values["Horarios Permanente"]),
    image_url: cleanText(row.values["Imagen"]),
    status_raw: cleanText(row.values["Estado"]),
  };

  const event: Event = {
    id: eventId(title, start, venue),
    source: SOURCE_ID,
    source_row: row.index,
    ...base,
    active: true,
    first_seen: now,
    last_seen: now,
    content_hash: contentHash(base),
  };

  return { event, warnings };
}

export interface NormalizeRowsResult {
  events: Event[];
  warnings: string[];
}

export function normalizeRows(rows: GvizRow[], now: string): NormalizeRowsResult {
  const events: Event[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const { event, warnings: rowWarnings } = normalizeRow(row, now);
    warnings.push(...rowWarnings);
    if (!event) continue;
    if (seen.has(event.id)) {
      warnings.push(`fila ${row.index}: id duplicado ${event.id} ("${event.title}"), se ignora`);
      continue;
    }
    seen.add(event.id);
    events.push(event);
  }
  return { events, warnings };
}
