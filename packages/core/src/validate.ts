import { createHash } from "node:crypto";
import { AGENDA_URL, BUNDLE_URL_FRAGMENT, EXPECTED_COLUMNS, gvizUrl, SHEET_ID } from "./config.js";
import { columns, fetchGviz, httpText, unwrap } from "./gviz.js";
import type { Check, ValidationResult } from "./models.js";
import { schemaHash } from "./store.js";

const SHEET_ID_RE = /[a-zA-Z0-9_-]{30,}/;

/** `<app-root sheetid="...">`: acá vive el ID real (el bundle lo recibe por atributo). */
export function extractSheetIds(html: string): string[] {
  const ids = new Set<string>();
  for (const m of html.matchAll(/sheetid\s*=\s*["']([a-zA-Z0-9_-]{30,})["']/gi)) {
    ids.add(m[1]!);
  }
  for (const m of html.matchAll(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]{30,})/g)) {
    ids.add(m[1]!);
  }
  return [...ids];
}

export function extractBundleUrl(html: string): string | null {
  for (const m of html.matchAll(/src\s*=\s*["']([^"']+)["']/gi)) {
    if (m[1]!.includes(BUNDLE_URL_FRAGMENT)) return m[1]!;
  }
  return null;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function worst(checks: Check[]): ValidationResult["status"] {
  if (checks.some((c) => c.level === "fail")) return "fail";
  if (checks.some((c) => c.level === "warn")) return "warn";
  return "ok";
}

export interface ValidateOptions {
  agendaUrl?: string;
  sheetId?: string;
  previousBundleHash?: string | null;
  /** Inyección para tests: devuelve el cuerpo de una URL. */
  fetchText?: (url: string) => Promise<string>;
}

export interface ValidateInputs {
  html: string | null;
  /** null = no se pudo bajar la página (Wordfence, 403/503...). */
  pageError?: string | null;
  bundleJs?: string | null;
  bundleUrl?: string | null;
  gviz: string | null;
  gvizError?: string | null;
  previousBundleHash?: string | null;
  sheetId?: string;
  at?: string;
}

/** Lógica pura, sin red: la usan los tests y `validateSource`. */
export function evaluate(inputs: ValidateInputs): ValidationResult {
  const expectedSheetId = inputs.sheetId ?? SHEET_ID;
  const checks: Check[] = [];
  let bundleHash: string | null = null;
  let schema: string | null = null;
  let rowCount: number | null = null;

  // 1. La página responde.
  if (inputs.html === null) {
    checks.push({
      level: "warn",
      code: "page_blocked",
      message: `No se pudo leer la página de la agenda: ${inputs.pageError ?? "sin detalle"}`,
    });
  } else {
    checks.push({ level: "ok", code: "page_ok", message: "La página de la agenda responde 200" });

    // 2. El bundle sigue en la página.
    const bundleUrl = inputs.bundleUrl ?? extractBundleUrl(inputs.html);
    if (!bundleUrl) {
      checks.push({
        level: "fail",
        code: "bundle_missing",
        message: `No se encontró el <script> con "${BUNDLE_URL_FRAGMENT}" en la página`,
      });
    } else {
      checks.push({
        level: "ok",
        code: "bundle_present",
        message: `Bundle presente: ${bundleUrl}`,
      });
    }

    // 3. El sheet ID sigue siendo el mismo.
    const idsInPage = extractSheetIds(inputs.html);
    const idsInBundle = inputs.bundleJs ? extractSheetIds(inputs.bundleJs) : [];
    const found = [...new Set([...idsInPage, ...idsInBundle])].filter((id) => SHEET_ID_RE.test(id));
    if (found.length === 0) {
      checks.push({
        level: "warn",
        code: "sheet_id_not_found",
        message:
          "No se encontró ningún sheet ID en la página ni en el bundle (puede construirse en runtime)",
      });
    } else if (!found.includes(expectedSheetId)) {
      checks.push({
        level: "fail",
        code: "sheet_id_changed",
        message: `El sheet ID cambió. Esperado ${expectedSheetId}`,
        detail: { found },
      });
    } else {
      checks.push({
        level: "ok",
        code: "sheet_id_ok",
        message: "El sheet ID sigue siendo el mismo",
      });
    }
  }

  // 5. Hash del bundle (INFO si cambió pero el ID sigue igual).
  if (inputs.bundleJs) {
    bundleHash = sha256(inputs.bundleJs);
    if (inputs.previousBundleHash && inputs.previousBundleHash !== bundleHash) {
      checks.push({
        level: "info",
        code: "bundle_changed",
        message: "El bundle cambió (mismo sheet ID): conviene revisar si cambió el formato",
        detail: { previous: inputs.previousBundleHash, current: bundleHash },
      });
    }
  }

  // 4. El esquema de la planilla no cambió.
  if (inputs.gviz === null) {
    checks.push({
      level: "fail",
      code: "gviz_unreachable",
      message: `No se pudo leer la planilla: ${inputs.gvizError ?? "sin detalle"}`,
    });
  } else {
    try {
      const payload = unwrap(inputs.gviz);
      const cols = columns(payload);
      schema = schemaHash(cols);
      rowCount = payload.table.rows.length;
      const missing = EXPECTED_COLUMNS.filter((c) => !cols.includes(c));
      const extra = cols.filter((c) => !EXPECTED_COLUMNS.includes(c as never));
      if (missing.length > 0 || extra.length > 0) {
        checks.push({
          level: "fail",
          code: "schema_changed",
          message: "Las columnas de la planilla cambiaron",
          detail: { missing, extra, found: cols },
        });
      } else {
        checks.push({
          level: "ok",
          code: "schema_ok",
          message: `Esquema sin cambios (${cols.length} columnas)`,
        });
      }
      if (rowCount === 0) {
        checks.push({ level: "warn", code: "empty_sheet", message: "La planilla tiene 0 filas" });
      }
    } catch (err) {
      checks.push({
        level: "fail",
        code: "gviz_unparseable",
        message: `No se pudo parsear la respuesta gviz: ${(err as Error).message}`,
      });
    }
  }

  return {
    at: inputs.at ?? new Date().toISOString(),
    status: worst(checks),
    checks,
    schema_hash: schema,
    bundle_hash: bundleHash,
    row_count: rowCount,
  };
}

export async function validateSource(options: ValidateOptions = {}): Promise<ValidationResult> {
  const get = options.fetchText ?? ((url: string) => httpText(url));
  const agendaUrl = options.agendaUrl ?? AGENDA_URL;
  const sheetId = options.sheetId ?? SHEET_ID;

  let html: string | null = null;
  let pageError: string | null = null;
  try {
    html = await get(agendaUrl);
  } catch (err) {
    pageError = (err as Error).message;
  }

  const bundleUrl: string | null = html ? extractBundleUrl(html) : null;
  let bundleJs: string | null = null;
  if (bundleUrl) {
    const absolute = bundleUrl.startsWith("http")
      ? bundleUrl
      : new URL(bundleUrl, agendaUrl).toString();
    try {
      bundleJs = await get(absolute);
    } catch {
      bundleJs = null;
    }
  }

  let gviz: string | null = null;
  let gvizError: string | null = null;
  try {
    gviz = options.fetchText
      ? await options.fetchText(gvizUrl(sheetId))
      : await fetchGviz(gvizUrl(sheetId));
  } catch (err) {
    gvizError = (err as Error).message;
  }

  return evaluate({
    html,
    pageError,
    bundleJs,
    bundleUrl,
    gviz,
    gvizError,
    previousBundleHash: options.previousBundleHash ?? null,
    sheetId,
  });
}
