/**
 * Parseo de la planilla del Colegio de Farmacéuticos. Funciones puras: la
 * lectura del .xlsx vive en `xlsx.ts` y la orquestación en `ingest.ts`.
 *
 * Forma de la planilla (verificada contra el turnero 2026):
 *  - Hoja "TURNERO <año>": col A = día del mes, y una columna por mes
 *    (enero..diciembre) cuya celda es el número de turno (1..30). Hay una
 *    columna extra que repite el día; por eso mapeamos los meses por su
 *    encabezado y no por posición.
 *  - Hojas "1".."30": col A = sección (viene sólo en la primera fila de cada
 *    sección, hay que arrastrarla), col B = "NOMBRE - dirección Bº barrio".
 */
import { normalizeKey } from "../text.js";
import type { ParseConfidence } from "./models.js";
import { asInteger, type Sheet } from "./xlsx.js";

export interface ParsedEntry {
  name: string | null;
  address: string | null;
  barrio: string | null;
  raw: string;
  parse_confidence: ParseConfidence;
}

export interface ParsedPharmacyRow extends ParsedEntry {
  turno: number;
  section: number | null;
  /** Fila en la hoja: sirve para señalar el dato crudo cuando algo no cierra. */
  sheet_row: number;
}

export interface ParsedWorkbook {
  year: number;
  rows: ParsedPharmacyRow[];
  /** aaaa-mm-dd -> turno. */
  days: Record<string, number>;
  /** Turnos (hojas) encontrados. */
  turnos: number[];
  warnings: string[];
}

export class ParseError extends Error {}

/* ------------------------------------------------- nombre / dirección ----- */

/**
 * `Bº`, `B°`, `Bo.`, `Bo`, `Barrio`: el marcador de barrio al final de la celda.
 * El `\b` después de `Bo` no es opcional: sin él, "Bonaire 2095" matchea como
 * barrio "naire 2095" y la dirección queda en null.
 */
const MARKER_SOURCE = "(?:B[º°]\\.?|Bo\\.|Bo\\b|Barrio\\b)";
const BARRIO = new RegExp(`^(.*?)(?:^|[\\s,.\\-])${MARKER_SOURCE}\\s*([^\\-]+)$`, "i");
const BARRIO_MARKER = new RegExp(`^${MARKER_SOURCE}`, "i");

/**
 * Elige el guion que separa nombre de dirección: primero los que tienen espacio
 * a algún lado ("WAL-MART - Av. Colón" corta en el segundo, no en el primero) y
 * salteando el que antecede al barrio ("MADUSSI-Libertad 2033 - B° General Paz").
 */
export function dashIndex(value: string): number | null {
  const spaced: number[] = [];
  const bare: number[] = [];
  for (let i = 2; i < value.length - 1; i++) {
    if (value[i] !== "-") continue;
    bare.push(i);
    if (value[i - 1] === " " || value[i + 1] === " ") spaced.push(i);
  }
  const notBarrio = (i: number) => !BARRIO_MARKER.test(value.slice(i + 1).trim());
  for (const group of [spaced.filter(notBarrio), bare.filter(notBarrio), spaced, bare]) {
    if (group.length > 0) return group[0]!;
  }
  return null;
}

const MAYUSCULA = /\p{Lu}/u;
const MINUSCULA = /\p{Ll}/u;

/** Un token "de nombre": sin minúsculas (MAURENZI, II, 59, +). */
const looksLikeName = (token: string): boolean => !MINUSCULA.test(token);

/**
 * Sin guion ("MAURENZI Av. Olmos 395 Bº Centro") el corte se adivina: los
 * nombres vienen en mayúsculas y las direcciones en capitalización normal, así
 * que tomamos el prefijo en mayúsculas. Son 20 de 850 filas y quedan marcadas
 * con `parse_confidence: "baja"`.
 */
export function splitWithoutDash(value: string): { name: string | null; rest: string | null } {
  const tokens = value.split(" ");
  const name: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    // "27 de Abril", "9 de Julio": el número es de la calle, no del nombre.
    if (/^\d+$/.test(token) && normalizeKey(tokens[i + 1] ?? "") === "de") break;
    if (!looksLikeName(token)) break;
    name.push(token);
  }
  const rest = tokens.slice(name.length).join(" ");
  return { name: name.join(" ") || null, rest: rest || null };
}

const clean = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.replace(/\s+/g, " ").replace(/^[\s.,-]+|[\s.,-]+$/g, "");
  return trimmed === "" ? null : trimmed;
};

/** "NOMBRE - Av. Colón 2806 Bº Centro" -> nombre, dirección y barrio. */
export function parseEntry(raw: string): ParsedEntry {
  const value = raw.replace(/\s+/g, " ").trim();
  const dash = dashIndex(value);

  let name: string | null;
  let rest: string | null;
  let confidence: ParseConfidence;
  if (dash !== null) {
    name = clean(value.slice(0, dash));
    rest = clean(value.slice(dash + 1));
    confidence = "alta";
  } else {
    const split = splitWithoutDash(value);
    name = clean(split.name);
    rest = clean(split.rest);
    confidence = "baja";
  }

  let barrio: string | null = null;
  if (rest) {
    const match = BARRIO.exec(rest);
    if (match) {
      barrio = clean(match[2]!);
      rest = clean(match[1]!);
    }
  }

  return { name, address: rest, barrio, raw: value, parse_confidence: confidence };
}

/* ------------------------------------------------------------ calendario -- */

const MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const TURNERO_SHEET = /turnero\s*(\d{4})/i;

export function findTurneroSheet(sheets: Sheet[]): { sheet: Sheet; year: number } | null {
  for (const sheet of sheets) {
    const match = TURNERO_SHEET.exec(sheet.name);
    if (match) return { sheet, year: Number.parseInt(match[1]!, 10) };
  }
  return null;
}

/** Hoja "TURNERO <año>" -> { "aaaa-mm-dd": turno }. */
export function parseCalendarSheet(
  sheet: Sheet,
  year: number,
): { days: Record<string, number>; warnings: string[] } {
  const warnings: string[] = [];

  // Fila de encabezados: la que tiene más nombres de mes.
  let monthColumns: Record<string, number> = {};
  let headerRow = -1;
  for (const row of sheet.rows) {
    const found: Record<string, number> = {};
    for (const [column, text] of Object.entries(row.cells)) {
      const month = MONTHS[normalizeKey(text)];
      if (month !== undefined) found[column] = month;
    }
    if (Object.keys(found).length > Object.keys(monthColumns).length) {
      monthColumns = found;
      headerRow = row.row;
    }
  }
  if (Object.keys(monthColumns).length === 0) {
    throw new ParseError(`La hoja "${sheet.name}" no tiene una fila con los nombres de los meses`);
  }
  if (Object.keys(monthColumns).length !== 12) {
    warnings.push(
      `La hoja "${sheet.name}" declara ${Object.keys(monthColumns).length} meses en vez de 12`,
    );
  }

  const days: Record<string, number> = {};
  for (const row of sheet.rows) {
    if (row.row <= headerRow) continue;
    const day = asInteger(row.cells["A"]);
    if (day === null || day < 1 || day > 31) continue;

    for (const [column, month] of Object.entries(monthColumns)) {
      const turno = asInteger(row.cells[column]);
      if (turno === null) continue;
      if (day > daysInMonth(year, month)) continue; // 29/02 en año no bisiesto, 31 en meses de 30
      const date = `${year}-${pad(month)}-${pad(day)}`;
      const previous = days[date];
      if (previous !== undefined && previous !== turno) {
        warnings.push(`${date} aparece con dos turnos distintos (${previous} y ${turno})`);
      }
      days[date] = turno;
    }
  }
  return { days, warnings };
}

/* ------------------------------------------------------- hojas de turno --- */

const SECTION_HEADER = /secc/i;
const TURNO_HEADER = /turno/i;

/** Hoja "7" -> las farmacias del turno 7, con su sección arrastrada. */
export function parseTurnoSheet(sheet: Sheet, turno: number): ParsedPharmacyRow[] {
  const rows: ParsedPharmacyRow[] = [];
  let section: number | null = null;

  for (const row of sheet.rows) {
    const a = row.cells["A"];
    const b = row.cells["B"];
    if (a !== undefined && !SECTION_HEADER.test(a)) {
      const parsed = asInteger(a);
      if (parsed !== null) section = parsed;
    }
    if (b === undefined) continue;
    if (TURNO_HEADER.test(b) && b.length < 24) continue; // "1º TURNO"
    if (SECTION_HEADER.test(b) && b.length < 12) continue;
    // Celdas con un número suelto: basura de la planilla, no una farmacia.
    if (asInteger(b) !== null) continue;
    if (!MAYUSCULA.test(b) && !/\d/.test(b)) continue;

    rows.push({ ...parseEntry(b), turno, section, sheet_row: row.row });
  }
  return rows;
}

/** Parsea el libro completo: calendario + farmacias de los 30 turnos. */
export function parseWorkbook(sheets: Sheet[]): ParsedWorkbook {
  const turnero = findTurneroSheet(sheets);
  if (!turnero) {
    throw new ParseError(
      `No encontré la hoja "TURNERO <año>" (hojas: ${sheets.map((s) => s.name).join(", ")})`,
    );
  }
  const { days, warnings } = parseCalendarSheet(turnero.sheet, turnero.year);

  const rows: ParsedPharmacyRow[] = [];
  const turnos: number[] = [];
  for (const sheet of sheets) {
    if (!/^\d+$/.test(sheet.name.trim())) continue;
    const turno = Number.parseInt(sheet.name.trim(), 10);
    turnos.push(turno);
    const parsed = parseTurnoSheet(sheet, turno);
    if (parsed.length === 0) warnings.push(`La hoja "${sheet.name}" no tiene farmacias`);
    rows.push(...parsed);
  }

  turnos.sort((a, b) => a - b);
  return { year: turnero.year, rows, days, turnos, warnings };
}
