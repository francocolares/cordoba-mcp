import { z } from "zod";
import { CountsSchema, ValidationResultSchema } from "../models.js";

export const DirectoryTermSchema = z.object({
  id: z.number().int(),
  name: z.string(),
});
export type DirectoryTerm = z.infer<typeof DirectoryTermSchema>;

export const CatalogSchema = z.object({
  title: z.string(),
  url: z.string(),
});
export type Catalog = z.infer<typeof CatalogSchema>;

export const ExporterSchema = z.object({
  id: z.string(),
  source: z.string(),
  url: z.string(),

  name: z.string(),
  legal_name: z.string().nullable(),
  logo_url: z.string().nullable(),

  website: z.string().nullable(),
  socials: z.record(z.string(), z.string()),
  catalogs: z.array(CatalogSchema),

  description: z.string().nullable(),
  exporter_profile: z.string().nullable(),
  label: z.string().nullable(),

  sectors: z.array(DirectoryTermSchema),
  export_countries: z.array(DirectoryTermSchema),
  exportable_offer: z.array(z.string()),

  restricted_fields: z.array(z.string()),

  active: z.boolean(),
  first_seen: z.string(),
  last_seen: z.string(),
  content_hash: z.string(),
});
export type Exporter = z.infer<typeof ExporterSchema>;

export const EXPORTER_SCALAR_FIELDS = [
  "name",
  "legal_name",
  "logo_url",
  "website",
  "description",
  "exporter_profile",
  "label",
] as const satisfies readonly (keyof Exporter)[];

export const EXPORTER_LIST_FIELDS = [
  "socials",
  "catalogs",
  "sectors",
  "export_countries",
  "exportable_offer",
  "restricted_fields",
] as const satisfies readonly (keyof Exporter)[];

export const ExportadoresStatusSchema = z.object({
  last_run: z.string(),
  validation: ValidationResultSchema.nullable(),
  counts: CountsSchema,
  source: z.string(),
  content_hash: z.string().nullable(),
  crawled_at: z.string().nullable(),
  directory_total: z.number().int(),
  directory_ids_hash: z.string().nullable(),
  excluded_natural_persons: z.number().int(),
  excluded_without_content: z.number().int(),
  with_website: z.number().int(),
});
export type ExportadoresStatus = z.infer<typeof ExportadoresStatusSchema>;
