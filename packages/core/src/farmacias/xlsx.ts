/**
 * Lector mínimo de .xlsx, sin dependencias: un .xlsx es un zip con XML adentro.
 * Alcanza para la planilla del Colegio (strings y números, sin fórmulas ni
 * fechas), y nos ahorra meter `exceljs` en un paquete que también se compila
 * para el Worker.
 */
import { inflateRawSync } from "node:zlib";

export interface SheetRow {
  /** Número de fila tal como lo trae la planilla (base 1). */
  row: number;
  /** Letra de columna -> texto de la celda. Las celdas vacías no aparecen. */
  cells: Record<string, string>;
}

export interface Sheet {
  name: string;
  rows: SheetRow[];
}

export class XlsxError extends Error {}

/* ------------------------------------------------------------------ zip ---- */

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

function findEocd(buf: Buffer): number {
  // El comentario final puede medir hasta 64 KB; buscamos la firma de atrás hacia adelante.
  const min = Math.max(0, buf.length - 0xffff - 22);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD) return i;
  }
  throw new XlsxError("No parece un zip: no encontré el End of Central Directory");
}

function readCentralDirectory(buf: Buffer): Map<string, ZipEntry> {
  const eocd = findEocd(buf);
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries = new Map<string, ZipEntry>();

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(offset) !== CENTRAL) {
      throw new XlsxError(`Entrada ${i} del central directory con firma inesperada`);
    }
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const entry: ZipEntry = {
      name: buf.toString("utf8", offset + 46, offset + 46 + nameLength),
      method: buf.readUInt16LE(offset + 10),
      compressedSize: buf.readUInt32LE(offset + 20),
      uncompressedSize: buf.readUInt32LE(offset + 24),
      localOffset: buf.readUInt32LE(offset + 42),
    };
    entries.set(entry.name, entry);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readEntry(buf: Buffer, entry: ZipEntry): string {
  const nameLength = buf.readUInt16LE(entry.localOffset + 26);
  const extraLength = buf.readUInt16LE(entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const raw = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return raw.toString("utf8");
  if (entry.method === 8) return inflateRawSync(raw).toString("utf8");
  throw new XlsxError(`Método de compresión no soportado (${entry.method}) en ${entry.name}`);
}

/* ------------------------------------------------------------------ xml ---- */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export function unescapeXml(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    }
    if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return ENTITIES[body] ?? match;
  });
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(tag);
  return m ? unescapeXml(m[1]!) : null;
};

/** Concatena el texto de todos los `<t>` de un fragmento (los rich text vienen partidos). */
function textOf(fragment: string): string {
  let out = "";
  for (const m of fragment.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)) {
    out += unescapeXml(m[1] ?? "");
  }
  return out;
}

function sharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const out: string[] = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\s*\/>/g)) {
    out.push(textOf(m[1] ?? ""));
  }
  return out;
}

const COLUMN = /^([A-Z]+)/;

function parseSheet(xml: string, strings: string[]): SheetRow[] {
  const rows: SheetRow[] = [];
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const row = Number.parseInt(attr(rowMatch[1]!, "r") ?? "0", 10);
    const cells: Record<string, string> = {};
    for (const cellMatch of rowMatch[2]!.matchAll(/<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = cellMatch[1]!;
      const body = cellMatch[3] ?? "";
      const ref = attr(tag, "r") ?? "";
      const column = COLUMN.exec(ref)?.[1];
      if (!column) continue;

      const type = attr(tag, "t");
      let value: string;
      if (type === "inlineStr") {
        value = textOf(body);
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body);
        if (!v) continue;
        const text = unescapeXml(v[1]!);
        if (type === "s") {
          const index = Number.parseInt(text, 10);
          value = strings[index] ?? "";
        } else {
          value = text;
        }
      }
      value = value.trim();
      if (value !== "") cells[column] = value;
    }
    if (Object.keys(cells).length > 0) rows.push({ row, cells });
  }
  return rows;
}

/* --------------------------------------------------------------- lectura --- */

/** Lee todas las hojas de un .xlsx en memoria, en el orden del libro. */
export function readXlsx(buffer: Buffer): Sheet[] {
  const entries = readCentralDirectory(buffer);
  const get = (name: string): string | null => {
    const entry = entries.get(name);
    return entry ? readEntry(buffer, entry) : null;
  };

  const workbook = get("xl/workbook.xml");
  if (!workbook) throw new XlsxError("El zip no contiene xl/workbook.xml: ¿es realmente un .xlsx?");
  const rels = get("xl/_rels/workbook.xml.rels") ?? "";

  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attr(m[1]!, "Id");
    const target = attr(m[1]!, "Target");
    if (id && target) targets.set(id, target);
  }

  const strings = sharedStrings(get("xl/sharedStrings.xml"));
  const sheets: Sheet[] = [];

  for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const tag = m[1]!;
    const name = attr(tag, "name");
    const relId = attr(tag, "r:id") ?? attr(tag, "id");
    if (!name || !relId) continue;
    const target = targets.get(relId);
    if (!target) continue;
    const path = target.startsWith("/")
      ? target.slice(1)
      : target.startsWith("xl/")
        ? target
        : `xl/${target}`;
    const xml = get(path);
    if (xml === null)
      throw new XlsxError(`La hoja "${name}" apunta a ${path}, que no está en el zip`);
    sheets.push({ name, rows: parseSheet(xml, strings) });
  }

  if (sheets.length === 0) throw new XlsxError("El libro no declara ninguna hoja");
  return sheets;
}

/** Texto de una celda, o null. `cell(sheet, 3, "B")`. */
export function cell(sheet: Sheet, row: number, column: string): string | null {
  return sheet.rows.find((r) => r.row === row)?.cells[column] ?? null;
}

/** Sólo celdas que son un número entero y nada más: "3.0", "30". */
const NUMERIC = /^-?\d+(?:[.,]\d+)?$/;

/**
 * Los números de la planilla llegan como "3.0" / "30". Exigimos que la celda
 * entera sea numérica: con `parseFloat` suelto, "24 - 24 de Septiembre 2192"
 * (una farmacia que se llama 24) pasaba por número y se perdía la fila.
 */
export function asInteger(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const text = value.trim();
  if (!NUMERIC.test(text)) return null;
  const n = Number.parseFloat(text.replace(",", "."));
  return Number.isFinite(n) && Number.isInteger(Math.round(n * 1000) / 1000) ? Math.round(n) : null;
}
