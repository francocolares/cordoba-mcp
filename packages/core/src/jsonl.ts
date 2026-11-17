/**
 * Parseo de los .jsonl, sin dependencias de Node: lo usan igual el scraper
 * (filesystem) y el Worker (objetos de R2).
 */

import type { Pharmacy } from "./farmacias/models.js";
import { PharmacySchema } from "./farmacias/models.js";
import { type Event, EventSchema } from "./models.js";

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

export function parseEventsJsonl(text: string): Event[] {
  return lines(text).map((line, i) => {
    const parsed = EventSchema.safeParse(JSON.parse(line));
    if (!parsed.success) {
      throw new Error(`events.jsonl línea ${i + 1} inválida: ${parsed.error.message}`);
    }
    return parsed.data;
  });
}

export function parsePharmaciesJsonl(text: string): Pharmacy[] {
  return lines(text).map((line, i) => {
    const parsed = PharmacySchema.safeParse(JSON.parse(line));
    if (!parsed.success) {
      throw new Error(`pharmacies.jsonl línea ${i + 1} inválida: ${parsed.error.message}`);
    }
    return parsed.data;
  });
}

/** `last_seen` más reciente del lote: el fallback de `data_as_of`. */
export function latestSeen(rows: { last_seen: string }[]): string {
  let out = "";
  for (const row of rows) if (row.last_seen > out) out = row.last_seen;
  return out;
}

/** JSON.parse tolerante: `null` si falta el archivo o no parsea. */
export function parseJsonOr<T>(
  text: string | null | undefined,
  fallback: T | null = null,
): T | null {
  if (text === null || text === undefined || text.trim() === "") return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
