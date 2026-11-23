import { z } from "zod";
import { TZ_OFFSET } from "../config.js";
import { sha1 } from "../normalize.js";
import { companyUrl, EXPORTADORES_SOURCE_ID, UNRESOLVED_PROFILE } from "./config.js";
import type { Catalog, DirectoryTerm, Exporter } from "./models.js";
import { EXPORTER_LIST_FIELDS, EXPORTER_SCALAR_FIELDS } from "./models.js";
import { isNaturalPerson } from "./natural-person.js";
import type { DirectoryListingEntry, Ficha } from "./parse.js";

export interface ExporterInput {
  externalId: string;
  withoutContent: boolean;
  name: string | null;
  legalName: string | null;
  logoUrl: string | null;
  website: string | null;
  socials: Record<string, string>;
  catalogs: Catalog[];
  description: string | null;
  exporterProfile: string | null;
  label: string | null;
  sectors: DirectoryTerm[];
  exportCountries: DirectoryTerm[];
  exportableOffer: string[];
  restrictedFields: string[];
}

export interface ExcludedCounts {
  naturalPersons: number;
  withoutContent: number;
}

export interface NormalizeExportersResult {
  exporters: Exporter[];
  excluded: ExcludedCounts;
  warnings: string[];
}

const nullable = (value: string | undefined | null): string | null =>
  value === undefined || value === null || value.trim() === "" ? null : value.trim();

const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/;

export function toInstant(value: string | null): string | null {
  if (value === null) return null;
  const withOffset = HAS_OFFSET.test(value) ? value : `${value}${TZ_OFFSET}`;
  const parsed = Date.parse(withOffset);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

export function fichaToInput(ficha: Ficha, entry?: DirectoryListingEntry): ExporterInput {
  return {
    externalId: ficha.externalId,
    withoutContent: ficha.withoutContent,
    name: nullable(ficha.name ?? entry?.name),
    legalName: nullable(ficha.legalName ?? entry?.legalName),
    logoUrl: nullable(ficha.logoUrl ?? entry?.logoUrl),
    website: nullable(ficha.website),
    socials: ficha.socials,
    catalogs: ficha.catalogs,
    description: nullable(ficha.description),
    exporterProfile: nullable(ficha.exporterProfile),
    label: nullable(ficha.label ?? entry?.label),
    sectors: ficha.sectors.length > 0 ? ficha.sectors : (entry?.sectors ?? []),
    exportCountries: ficha.exportCountries,
    exportableOffer: ficha.exportableOffer,
    restrictedFields: ficha.restrictedFields,
  };
}

const RawTermSchema = z.object({ id: z.number().int().nullable(), nombre: z.string() });

const RawOfferSchema = z.union([
  z.string(),
  z.object({ descripcion: z.string().nullable() }).passthrough(),
]);

const RawCompanySchema = z
  .object({
    id: z.union([z.number().int(), z.string()]),
    sin_contenido: z.boolean().optional(),
    nombre: z.string().nullable().optional(),
    razon_social: z.string().nullable().optional(),
    logo: z.string().nullable().optional(),
    sitio_web: z.string().nullable().optional(),
    redes: z.record(z.string(), z.string()).nullable().optional(),
    catalogos: z
      .array(z.object({ titulo: z.string().nullable(), url: z.string() }))
      .nullable()
      .optional(),
    descripcion: z.string().nullable().optional(),
    perfil_exportador: z.string().nullable().optional(),
    etiqueta: z.string().nullable().optional(),
    rubros: z.array(RawTermSchema).nullable().optional(),
    paises_exporta: z.array(RawTermSchema).nullable().optional(),
    oferta_exportable: z.array(RawOfferSchema).nullable().optional(),
    campos_restringidos: z.array(z.string()).nullable().optional(),
  })
  .passthrough();

export const DirectorioFileSchema = z
  .object({
    extraido: z.string().nullable().optional(),
    total: z.number().int().nullable().optional(),
    empresas: z.array(RawCompanySchema),
  })
  .passthrough();

export type DirectorioFile = z.infer<typeof DirectorioFileSchema>;

export interface DirectorioFileContents {
  inputs: ExporterInput[];
  crawledAt: string | null;
  directoryTotal: number;
}

export function readDirectorioFile(payload: unknown): DirectorioFileContents {
  const file = DirectorioFileSchema.parse(payload);
  const inputs = file.empresas.map((company) => {
    const externalId = String(company.id);
    return {
      externalId,
      withoutContent: company.sin_contenido === true,
      name: nullable(company.nombre),
      legalName: nullable(company.razon_social),
      logoUrl: nullable(company.logo),
      website: nullable(company.sitio_web),
      socials: company.redes ?? {},
      catalogs: (company.catalogos ?? []).map((catalog) => ({
        title: nullable(catalog.titulo) ?? catalog.url,
        url: catalog.url,
      })),
      description: nullable(company.descripcion),
      exporterProfile: nullable(company.perfil_exportador),
      label: nullable(company.etiqueta),
      sectors: terms(company.rubros),
      exportCountries: terms(company.paises_exporta),
      exportableOffer: offers(company.oferta_exportable),
      restrictedFields: company.campos_restringidos ?? [],
    } satisfies ExporterInput;
  });

  return {
    inputs,
    crawledAt: toInstant(nullable(file.extraido)),
    directoryTotal: file.total ?? inputs.length,
  };
}

function terms(raw: { id: number | null; nombre: string }[] | null | undefined): DirectoryTerm[] {
  return (raw ?? []).map((term) => ({ id: term.id ?? 0, name: term.nombre }));
}

function offers(raw: z.infer<typeof RawOfferSchema>[] | null | undefined): string[] {
  return (raw ?? []).flatMap((item) => {
    if (typeof item === "string") return item.trim() === "" ? [] : [item.trim()];
    const description = nullable(item.descripcion);
    return description === null ? [] : [description];
  });
}

export function exporterContentHash(exporter: Omit<Exporter, "content_hash">): string {
  const scalars = EXPORTER_SCALAR_FIELDS.map((field) => `${field}=${exporter[field] ?? ""}`);
  const lists = EXPORTER_LIST_FIELDS.map(
    (field) => `${field}=${JSON.stringify(exporter[field] ?? null)}`,
  );
  return sha1([...scalars, ...lists].join("\n"));
}

export function toExporters(
  inputs: readonly ExporterInput[],
  now: string,
): NormalizeExportersResult {
  const exporters: Exporter[] = [];
  const warnings: string[] = [];
  const excluded: ExcludedCounts = { naturalPersons: 0, withoutContent: 0 };
  const seen = new Set<string>();

  for (const input of inputs) {
    if (input.withoutContent || input.name === null) {
      excluded.withoutContent++;
      continue;
    }
    if (isNaturalPerson(input.legalName) !== false) {
      excluded.naturalPersons++;
      continue;
    }
    if (seen.has(input.externalId)) {
      warnings.push(`ficha repetida en la fuente: ${input.externalId}`);
      continue;
    }
    seen.add(input.externalId);

    const profile = input.exporterProfile;
    const withoutHash = {
      id: input.externalId,
      source: EXPORTADORES_SOURCE_ID,
      url: companyUrl(input.externalId),
      name: input.name,
      legal_name: input.legalName,
      logo_url: input.logoUrl,
      website: input.website,
      socials: input.socials,
      catalogs: input.catalogs,
      description: input.description,
      exporter_profile: profile === UNRESOLVED_PROFILE ? null : profile,
      label: input.label,
      sectors: input.sectors,
      export_countries: input.exportCountries,
      exportable_offer: input.exportableOffer,
      restricted_fields: input.restrictedFields,
      active: true,
      first_seen: now,
      last_seen: now,
    } satisfies Omit<Exporter, "content_hash">;

    exporters.push({ ...withoutHash, content_hash: exporterContentHash(withoutHash) });
  }

  return { exporters, excluded, warnings };
}

export function directoryIdsHash(ids: readonly string[]): string {
  return sha1([...ids].sort().join(",")).slice(0, 16);
}
