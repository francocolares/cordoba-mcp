import { companyUrl, SOURCE_MASK } from "./config.js";
import { absolute, all, balancedDiv, clean, first, stripScripts } from "./html.js";
import type { Catalog, DirectoryTerm } from "./models.js";

export interface DirectoryListingEntry {
  externalId: string;
  url: string;
  name: string;
  legalName?: string | undefined;
  label?: string | undefined;
  logoUrl?: string | undefined;
  sectors: DirectoryTerm[];
}

export interface Ficha {
  externalId: string;
  url: string;
  withoutContent: boolean;
  name?: string | undefined;
  legalName?: string | undefined;
  logoUrl?: string | undefined;
  website?: string | undefined;
  socials: Record<string, string>;
  catalogs: Catalog[];
  description?: string | undefined;
  exporterProfile?: string | undefined;
  label?: string | undefined;
  sectors: DirectoryTerm[];
  exportCountries: DirectoryTerm[];
  exportableOffer: string[];
  restrictedFields: string[];
}

function isMasked(value: string | undefined): boolean {
  return value?.includes(SOURCE_MASK) === true;
}

const CARD_START = '<div class="col-xs-6 col-sm-3 panel-body directorio">';
const CARD_ID = /single(?:\.php)?\?search=(\d+)/;
const CARD_NAME = /<p class="directorio-nombre">([\s\S]*?)<\/p>/;
const CARD_LEGAL_NAME = /<p class="directorio-razon">([\s\S]*?)<\/p>/;
const CARD_LABEL = /<span class="badge etiqueta-flotante-\w+">([\s\S]*?)<\/span>/;
const CARD_IMAGE = /<img class="directorio-card-imagen[^"]*" src="([^"]+)"/;
const CARD_SECTOR = /selectrubro%5B%5D=(\d+)"><span class="badge etiqueta">([\s\S]*?)<\/span>/;

export function parseDirectoryListing(html: string): DirectoryListingEntry[] {
  const entries: DirectoryListingEntry[] = [];
  const seen = new Set<string>();

  for (const card of stripScripts(html).split(CARD_START)) {
    if (!card.includes("directorio-card")) continue;

    const externalId = first(CARD_ID, card);
    if (externalId === undefined || seen.has(externalId)) continue;
    seen.add(externalId);

    const name = clean(first(CARD_NAME, card));
    if (name === undefined) continue;

    entries.push({
      externalId,
      url: companyUrl(externalId),
      name,
      legalName: clean(first(CARD_LEGAL_NAME, card)),
      label: clean(first(CARD_LABEL, card)),
      logoUrl: absolute(first(CARD_IMAGE, card)),
      sectors: terms(CARD_SECTOR, card),
    });
  }

  return entries;
}

const MAIN_BLOCK = '<div class="col-sm-8 panel-body">';
const SIDEBAR_BLOCK = '<div class="col-sm-3 panel-body">';

const FICHA_NAME = /font-size: 30px;[^"]*"><strong>([\s\S]*?)<\/strong>/;
const FICHA_LEGAL_NAME = /font-weight: 700;">([\s\S]*?)<\/p>/;
const LOGO = /<img src="(images_db\/[^"]+)"/;
const SOCIAL = /<a href="([^"]+)"[^>]*>\s*<i class="fa[bs]? fa-([a-z0-9-]+)"/;
const SOCIAL_BLOCK = /<div class="redes-sociales">([\s\S]*?)<\/div>/;
const WEBSITE = /SITIO WEB[\s\S]{0,400}?<a href="([^"]+)"[^>]*class="violeta"/;
const CATALOG = /<a href="([^"]+\.(?:pdf|PDF)[^"]*)"[^>]*class="violeta">([\s\S]*?)<\/a>/;
const SECTOR = /selectrubro%5B%5D=(\d+)"><span class="badge">([\s\S]*?)<\/span>/;
const COUNTRY = /selectpais%5B%5D=(\d+)"><span class="badge-pais">([\s\S]*?)<\/span>/;
const TABLE_ROW = /<tr>([\s\S]*?)<\/tr>/;
const TABLE_CELL = /<td[^>]*>([\s\S]*?)<\/td>/;
const DESCRIPTION = /color: #273247;">([\s\S]*?)<\/p>/;

interface Sections {
  description?: string;
  exporterProfile?: string;
  sectors?: string;
  countries?: string;
  offer?: string;
  chambers?: string;
}

const SECTION_TITLES: readonly (readonly [keyof Sections, string])[] = [
  ["description", "Descripción de la empresa"],
  ["exporterProfile", "Perfil Exportador"],
  ["sectors", "Rubros"],
  ["countries", "Países a los que Exporta"],
  ["offer", "Oferta exportable"],
  ["chambers", "Cámaras a las que pertenece"],
];

export function parseFicha(html: string, externalId: string): Ficha {
  const page = stripScripts(html);
  const main = balancedDiv(page, MAIN_BLOCK);

  if (main === undefined) {
    return {
      externalId,
      url: companyUrl(externalId),
      withoutContent: true,
      socials: {},
      catalogs: [],
      sectors: [],
      exportCountries: [],
      exportableOffer: [],
      restrictedFields: [],
    };
  }

  const sidebar = balancedDiv(page, SIDEBAR_BLOCK);
  const restricted = new Set<string>();

  const afterName = main.split("</strong>").slice(1).join("</strong>");
  const legalName = clean(first(FICHA_LEGAL_NAME, afterName));
  const sections = cutSections(main);

  const website = sidebar === undefined ? undefined : first(WEBSITE, sidebar);
  const isPdf = website?.toLowerCase().endsWith(".pdf") === true;

  if (page.includes(SOURCE_MASK) && page.includes("CONTACTAR")) restricted.add("contacto");
  collectChambers(sections.chambers, restricted);

  return {
    externalId,
    url: companyUrl(externalId),
    withoutContent: false,
    name: clean(first(FICHA_NAME, main)),
    legalName,
    logoUrl: sidebar === undefined ? undefined : absolute(first(LOGO, sidebar)),
    website: isPdf ? undefined : website,
    socials: sidebar === undefined ? {} : parseSocials(sidebar),
    catalogs: sidebar === undefined ? [] : parseCatalogs(sidebar),
    description: clean(first(DESCRIPTION, sections.description ?? "")),
    exporterProfile: parseExporterProfile(sections.exporterProfile),
    sectors: terms(SECTOR, sections.sectors ?? ""),
    exportCountries: terms(COUNTRY, sections.countries ?? ""),
    exportableOffer: parseOffer(sections.offer, restricted),
    restrictedFields: [...restricted],
  };
}

function cutSections(main: string): Sections {
  const marks: { index: number; key: keyof Sections }[] = [];
  for (const [key, title] of SECTION_TITLES) {
    const titled = main.indexOf(`>${title}`);
    const index = titled === -1 ? main.indexOf(title) : titled;
    if (index !== -1) marks.push({ index, key });
  }
  marks.sort((a, b) => a.index - b.index);

  const sections: Sections = {};
  for (const [position, mark] of marks.entries()) {
    const end = marks[position + 1]?.index ?? main.length;
    sections[mark.key] = main.slice(mark.index, end);
  }
  return sections;
}

function parseExporterProfile(section: string | undefined): string | undefined {
  if (section === undefined) return undefined;
  const body = section
    .split("</hr>")
    .at(-1)
    ?.replace(/[\s\S]*<hr[^>]*>/, "");
  return clean(body?.split("</p>")[0]);
}

function parseSocials(sidebar: string): Record<string, string> {
  const socialBlock = first(SOCIAL_BLOCK, sidebar) ?? "";
  const socials: Record<string, string> = {};
  for (const match of all(SOCIAL, socialBlock)) {
    const [, url, platform] = match;
    if (url === undefined || platform === undefined) continue;
    socials[platform] ??= url;
  }
  return socials;
}

function parseCatalogs(sidebar: string): Catalog[] {
  return all(CATALOG, sidebar).flatMap((match) => {
    const url = absolute(match[1]);
    if (url === undefined) return [];
    return [{ title: clean(match[2]) ?? url, url }];
  });
}

function parseOffer(section: string | undefined, restricted: Set<string>): string[] {
  if (section === undefined) return [];
  const items: string[] = [];
  for (const row of all(TABLE_ROW, section)) {
    const cells = all(TABLE_CELL, row[1] ?? "").map((cell) => clean(cell[1]));
    if (cells.length === 0) continue;
    if (cells.length > 1 && isMasked(cells[0])) {
      restricted.add("exportable_offer.posicion_arancelaria");
    }
    const description = cells.at(-1);
    if (description !== undefined && !isMasked(description)) items.push(description);
  }
  return items;
}

function collectChambers(section: string | undefined, restricted: Set<string>): void {
  if (section === undefined) return;
  for (const row of all(TABLE_ROW, section)) {
    for (const cell of all(TABLE_CELL, row[1] ?? "")) {
      const value = clean(cell[1]);
      if (value !== undefined && isMasked(value)) restricted.add("camaras");
    }
  }
}

function terms(pattern: RegExp, text: string): DirectoryTerm[] {
  return all(pattern, text).flatMap((match) => {
    const name = clean(match[2]);
    if (name === undefined) return [];
    const id = Number.parseInt(match[1] ?? "", 10);
    return [{ id: Number.isNaN(id) ? 0 : id, name }];
  });
}
