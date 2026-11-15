import { z } from "zod";

export const PriceType = z.enum(["gratis", "pago", "desconocido"]);
export type PriceType = z.infer<typeof PriceType>;

export const Category = z.enum([
  "musica",
  "teatro",
  "humor",
  "danza",
  "infantil",
  "visita_guiada",
  "museos_cultura",
  "feria",
  "conferencia",
  "fiesta",
  "streaming",
  "gastronomia",
  "otro",
]);
export type Category = z.infer<typeof Category>;

export const EventSchema = z.object({
  id: z.string(),
  source: z.string(),
  /** Índice de fila en la planilla. Informativo: no es estable entre runs. */
  source_row: z.number().int(),

  title: z.string(),
  description: z.string().nullable(),

  category_raw: z.string().nullable(),
  category: Category,

  /** ISO 8601 con offset de Córdoba, p. ej. 2026-11-15T20:00:00-03:00 */
  start: z.string(),
  end: z.string().nullable(),
  all_day: z.boolean(),

  venue: z.string().nullable(),
  organizer: z.string().nullable(),
  ticket_url: z.string().nullable(),

  price_type: PriceType,
  price_raw: z.string().nullable(),

  is_permanent: z.boolean(),
  permanent_schedule: z.string().nullable(),

  image_url: z.string().nullable(),
  status_raw: z.string().nullable(),

  active: z.boolean(),
  first_seen: z.string(),
  last_seen: z.string(),
  content_hash: z.string(),
});
export type Event = z.infer<typeof EventSchema>;

/** Campos que definen el contenido del evento (entran al content_hash). */
export const CONTENT_FIELDS = [
  "title",
  "description",
  "category_raw",
  "category",
  "start",
  "end",
  "all_day",
  "venue",
  "organizer",
  "ticket_url",
  "price_type",
  "price_raw",
  "is_permanent",
  "permanent_schedule",
  "image_url",
  "status_raw",
] as const satisfies readonly (keyof Event)[];

export const ChangeRecordSchema = z.object({
  at: z.string(),
  kind: z.enum(["added", "updated", "removed", "readded"]),
  id: z.string(),
  title: z.string(),
  fields: z.record(z.string(), z.tuple([z.unknown(), z.unknown()])).optional(),
});
export type ChangeRecord = z.infer<typeof ChangeRecordSchema>;

export const CheckSchema = z.object({
  level: z.enum(["ok", "info", "warn", "fail"]),
  code: z.string(),
  message: z.string(),
  detail: z.unknown().optional(),
});
export type Check = z.infer<typeof CheckSchema>;

export const ValidationResultSchema = z.object({
  at: z.string(),
  status: z.enum(["ok", "warn", "fail"]),
  checks: z.array(CheckSchema),
  schema_hash: z.string().nullable(),
  bundle_hash: z.string().nullable(),
  row_count: z.number().int().nullable(),
});
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

export const RunStatusSchema = z.object({
  last_run: z.string(),
  validation: ValidationResultSchema.nullable(),
  scraped: z.boolean(),
  counts: z.object({
    total: z.number().int(),
    active: z.number().int(),
    inactive: z.number().int(),
    added: z.number().int(),
    updated: z.number().int(),
    removed: z.number().int(),
    readded: z.number().int(),
  }),
  source: z.string(),
  schema_hash: z.string().nullable(),
  bundle_hash: z.string().nullable(),
});
export type RunStatus = z.infer<typeof RunStatusSchema>;
