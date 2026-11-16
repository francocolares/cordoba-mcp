import { z } from "zod";
import { CountsSchema, ValidationResultSchema } from "../models.js";

/** Qué tan confiable es el corte entre nombre y dirección de la fila cruda. */
export const ParseConfidence = z.enum(["alta", "baja"]);
export type ParseConfidence = z.infer<typeof ParseConfidence>;

/** Hasta dónde llegó el geocoding: altura exacta, calle, centroide del barrio, nada. */
export const GeocodePrecision = z.enum(["exacta", "calle", "barrio", "ninguna"]);
export type GeocodePrecision = z.infer<typeof GeocodePrecision>;

export const PharmacySchema = z.object({
  id: z.string(),
  source: z.string(),

  /** Turno (1..30) y sección (1..17) a los que pertenece. */
  turno: z.number().int(),
  section: z.number().int().nullable(),

  name: z.string().nullable(),
  address: z.string().nullable(),
  barrio: z.string().nullable(),
  /** La celda tal cual vino: es lo único 100% fiel a la fuente. */
  raw: z.string(),
  parse_confidence: ParseConfidence,

  lat: z.number().nullable(),
  lon: z.number().nullable(),
  geocode_precision: GeocodePrecision,
  /** Dirección tal como la resolvió el geocoder (para auditar la cache). */
  geocode_label: z.string().nullable(),

  active: z.boolean(),
  first_seen: z.string(),
  last_seen: z.string(),
  content_hash: z.string(),
});
export type Pharmacy = z.infer<typeof PharmacySchema>;

/** Lo que define el contenido de una farmacia (entra al content_hash). */
export const PHARMACY_CONTENT_FIELDS = [
  "turno",
  "section",
  "name",
  "address",
  "barrio",
  "raw",
] as const satisfies readonly (keyof Pharmacy)[];

/**
 * Calendario de un año: fecha -> número de turno. Guardamos los 365 días
 * explícitos (son 4 KB) y además el ancla, que es con lo que validamos que la
 * planilla siga respetando el ciclo de 30 días.
 */
export const TurnoCalendarSchema = z.object({
  year: z.number().int(),
  cycle_length: z.number().int(),
  anchor: z.object({ date: z.string(), turno: z.number().int() }),
  days: z.record(z.string(), z.number().int()),
  source_file: z.string(),
  /** Hash del contenido normalizado, no del binario: el .xlsx que exporta Drive cambia en cada descarga. */
  content_hash: z.string(),
  ingested_at: z.string(),
});
export type TurnoCalendar = z.infer<typeof TurnoCalendarSchema>;

export const TurnoCalendarsSchema = z.object({
  calendars: z.array(TurnoCalendarSchema),
});

export const FarmaciasStatusSchema = z.object({
  last_run: z.string(),
  validation: ValidationResultSchema.nullable(),
  counts: CountsSchema,
  /** Años con turnero cargado. */
  years: z.array(z.number().int()),
  geocoded: z.number().int(),
  pending_geocode: z.number().int(),
  source: z.string(),
  content_hash: z.string().nullable(),
});
export type FarmaciasStatus = z.infer<typeof FarmaciasStatusSchema>;
