import { normalizeKey, truncate } from "../text.js";
import type { DirectoryTerm, Exporter } from "./models.js";

export const EXPORTER_SUMMARY_MAX = 300;

export interface ExporterSummary {
  id: string;
  name: string;
  legal_name: string | null;
  website: string | null;
  exporter_profile: string | null;
  sectors: string[];
  export_countries: string[];
  description: string | null;
}

export function toExporterSummary(exporter: Exporter): ExporterSummary {
  return {
    id: exporter.id,
    name: exporter.name,
    legal_name: exporter.legal_name,
    website: exporter.website,
    exporter_profile: exporter.exporter_profile,
    sectors: termNames(exporter.sectors),
    export_countries: termNames(exporter.export_countries),
    description: truncate(exporter.description, EXPORTER_SUMMARY_MAX),
  };
}

export const termNames = (terms: readonly DirectoryTerm[]): string[] =>
  terms.map((term) => term.name);

export function matchesExporterText(exporter: Exporter, query: string): boolean {
  const needle = normalizeKey(query);
  if (needle === "") return true;
  const haystack = normalizeKey(
    [
      exporter.name,
      exporter.legal_name,
      exporter.description,
      ...exporter.exportable_offer,
      ...termNames(exporter.sectors),
    ]
      .filter(Boolean)
      .join(" "),
  );
  return needle.split(" ").every((token) => haystack.includes(token));
}

const matchesTerm = (terms: readonly DirectoryTerm[], value: string): boolean => {
  const needle = normalizeKey(value);
  return terms.some((term) => normalizeKey(term.name).includes(needle));
};

export const matchesSector = (exporter: Exporter, rubro: string): boolean =>
  matchesTerm(exporter.sectors, rubro);

export const matchesCountry = (exporter: Exporter, pais: string): boolean =>
  matchesTerm(exporter.export_countries, pais);

export interface ExporterSearchParams {
  query?: string | undefined;
  rubro?: string | undefined;
  pais?: string | undefined;
  perfil?: string | undefined;
  con_sitio?: boolean | undefined;
  include_inactive?: boolean | undefined;
}

const byName = (a: Exporter, b: Exporter) =>
  normalizeKey(a.name).localeCompare(normalizeKey(b.name));

export function searchExporters(
  exporters: readonly Exporter[],
  params: ExporterSearchParams = {},
): Exporter[] {
  return exporters
    .filter((e) => (params.include_inactive === true ? true : e.active))
    .filter((e) => (params.query === undefined ? true : matchesExporterText(e, params.query)))
    .filter((e) => (params.rubro === undefined ? true : matchesSector(e, params.rubro)))
    .filter((e) => (params.pais === undefined ? true : matchesCountry(e, params.pais)))
    .filter((e) =>
      params.perfil === undefined
        ? true
        : normalizeKey(e.exporter_profile) === normalizeKey(params.perfil),
    )
    .filter((e) =>
      params.con_sitio === undefined ? true : params.con_sitio === (e.website !== null),
    )
    .sort(byName);
}

export interface TermCount {
  key: string | number | null;
  count: number;
}

export function countTerms(
  exporters: readonly Exporter[],
  pick: (exporter: Exporter) => readonly (string | null)[],
): TermCount[] {
  const counts = new Map<string | null, number>();
  for (const exporter of exporters) {
    const keys = pick(exporter);
    if (keys.length === 0) counts.set(null, (counts.get(null) ?? 0) + 1);
    for (const key of new Set(keys)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
}

export const sectorCounts = (exporters: readonly Exporter[]): TermCount[] =>
  countTerms(exporters, (e) => termNames(e.sectors));

export const countryCounts = (exporters: readonly Exporter[]): TermCount[] =>
  countTerms(exporters, (e) => termNames(e.export_countries));

export const profileCounts = (exporters: readonly Exporter[]): TermCount[] =>
  countTerms(exporters, (e) => (e.exporter_profile === null ? [] : [e.exporter_profile]));
