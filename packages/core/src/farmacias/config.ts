/** Configuración de la fuente: cronograma de guardias del Colegio de Farmacéuticos. */

export const FARMACIAS_SOURCE_ID = "colegio_farmaceuticos" as const;

export const FARMACIAS_SOURCE_NAME =
  "Cronograma de Guardias Obligatorias – Colegio de Farmacéuticos de la Provincia de Córdoba" as const;

/** Página del Colegio: es el crédito que mostramos, no de donde bajamos el archivo. */
export const FARMACIAS_SOURCE_URL = "https://www.colfacor.org.ar/" as const;

/**
 * El turnero circula como archivo, no como API: es un .xls subido a Drive. El
 * endpoint `export?format=xlsx` responde anónimo, pero el binario cambia en cada
 * descarga (el zip no es reproducible), así que el detector de cambios compara
 * el hash del contenido normalizado, no el del archivo.
 */
export const TURNERO_FILE_ID = "1h2bmgMHLGWNaUOv2-eqomylk17LfKdze";

export const turneroUrl = (fileId: string = TURNERO_FILE_ID): string =>
  `https://docs.google.com/spreadsheets/d/${fileId}/export?format=xlsx`;

/** `process` no existe en Cloudflare Workers, así que leemos el env a la defensiva. */
function readEnv(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

/**
 * ATENCIÓN: la planilla no dice de qué hora a qué hora corre la guardia (no hay
 * leyenda ni nota en ninguna de las 31 hojas). Esta ventana es un supuesto
 * configurable y viaja declarada en cada respuesta, con `confirmado: false`
 * hasta que lo confirmemos con el Colegio.
 */
export const TURNO_START = readEnv("FARMACIAS_TURNO_START") ?? "08:30";
export const TURNO_DURATION_HOURS = Number(readEnv("FARMACIAS_TURNO_HORAS") ?? 24);
export const TURNO_WINDOW_CONFIRMED = readEnv("FARMACIAS_TURNO_CONFIRMADO") === "true";

export const FARMACIAS_DISCLAIMER =
  `El horario de la guardia no figura en la planilla del Colegio: se asume de ${TURNO_START} ` +
  `a ${TURNO_START} del día siguiente. Confirmá por teléfono antes de ir. ` +
  "Las coordenadas salen de geocodificar la dirección escrita en la planilla y pueden tener error de altura.";

/** Ciclo de rotación: 30 turnos, uno por día. */
export const TURNO_CYCLE_LENGTH = 30;

/** Secciones de la ciudad que usa el Colegio (1..17 en el turnero 2026). */
export const MAX_SECTION = 17;

export const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
/**
 * La política de uso de Nominatim pide como máximo 1 request por segundo; con
 * 1.1s igual nos devolvió 503 en una tanda larga, así que vamos más tranquilos.
 */
export const GEOCODE_DELAY_MS = 1500;
/** Reintentos ante 429/503, con espera creciente. */
export const GEOCODE_RETRY_WAITS_MS = [5_000, 20_000, 60_000];
