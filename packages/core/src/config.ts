/** Configuración de la fuente: Agenda Turística de la Municipalidad de Córdoba. */

export const SOURCE_ID = "turismo_muni" as const;

export const SOURCE_NAME = "Agenda Turística – Municipalidad de Córdoba" as const;

/** El ID real. `AGENDA_SHEET_ID` permite probar el camino de falla sin tocar el código. */
export const DEFAULT_SHEET_ID = "1RUZ_OOHkx2-xwg9UfzPMiEMv4pXEdJMZcXxbhk665Nw";

/** `process` no existe en Cloudflare Workers, así que leemos el env a la defensiva. */
function readEnv(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

export const SHEET_ID = readEnv("AGENDA_SHEET_ID") ?? DEFAULT_SHEET_ID;

export const gvizUrl = (sheetId: string = SHEET_ID): string =>
  `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json`;

export const GVIZ_URL = gvizUrl();

export const AGENDA_URL = "https://turismo.cordoba.gob.ar/agenda-turistica/";

/** Bundle Angular que renderiza la agenda dentro de WordPress. */
export const BUNDLE_URL_FRAGMENT = "agenda-cultura/main.js";

/** Columnas esperadas de la planilla, en orden (verificado 2026-11-12). */
export const EXPECTED_COLUMNS = [
  "fecha_ini",
  "Hora",
  "Fecha_fin",
  "Hora_fin",
  "Nombre",
  "Tipo de Evento",
  "Descripción",
  "Lugar",
  "Organizador",
  "Inscripción",
  "Precio",
  "Estado",
  "Permanente",
  "Horarios Permanente",
  "Imagen",
] as const;

/**
 * Córdoba usa UTC-3 todo el año (no hay horario de verano desde 2009), así que
 * trabajamos con un offset fijo en vez de arrastrar una librería de zonas.
 */
export const TZ = "America/Argentina/Cordoba";
export const TZ_OFFSET = "-03:00";
export const TZ_OFFSET_MINUTES = -180;

export const USER_AGENT = "cordoba-mcp-scraper/0.1 (+https://github.com/cordoba-mcp/cordoba-mcp)";

export const HTTP_TIMEOUT_MS = 30_000;
export const HTTP_RETRIES = 3;
