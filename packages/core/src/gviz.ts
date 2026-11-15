import { GVIZ_URL, HTTP_RETRIES, HTTP_TIMEOUT_MS, USER_AGENT } from "./config.js";

export interface GvizCell {
  v?: unknown;
  f?: string;
}

export interface GvizPayload {
  version?: string;
  status: string;
  errors?: { reason?: string; message?: string; detailed_message?: string }[];
  table: {
    cols: { id?: string; label?: string; type?: string }[];
    rows: { c: (GvizCell | null)[] }[];
  };
}

export class GvizError extends Error {}

export async function httpText(url: string, init?: RequestInit): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= HTTP_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "user-agent": USER_AGENT, ...(init?.headers ?? {}) },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!res.ok) throw new GvizError(`HTTP ${res.status} en ${url}`);
      return await res.text();
    } catch (err) {
      lastError = err;
      if (attempt < HTTP_RETRIES) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new GvizError(String(lastError));
}

export async function fetchGviz(url: string = GVIZ_URL): Promise<string> {
  return httpText(url);
}

/**
 * La respuesta gviz viene envuelta: `/*O_o*\/\ngoogle.visualization.Query.setResponse({...});`
 * Tomamos desde el primer `{` hasta el último `}`.
 */
export function unwrap(text: string): GvizPayload {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new GvizError("La respuesta gviz no contiene un objeto JSON envuelto");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    throw new GvizError(`No se pudo parsear el JSON de gviz: ${(err as Error).message}`);
  }
  const p = payload as Partial<GvizPayload>;
  if (p.status !== "ok") {
    const reason = p.errors?.map((e) => e.detailed_message ?? e.message ?? e.reason).join("; ");
    throw new GvizError(`gviz devolvió status="${p.status}"${reason ? `: ${reason}` : ""}`);
  }
  if (!p.table?.cols || !Array.isArray(p.table.rows)) {
    throw new GvizError("La respuesta gviz no trae table.cols / table.rows");
  }
  return p as GvizPayload;
}

export function columns(payload: GvizPayload): string[] {
  return payload.table.cols.map((c) => c.label ?? c.id ?? "");
}

/** Celda normalizada a string: prioriza `f` (formateado) sobre `v`. */
export function cellText(cell: GvizCell | null | undefined): string | null {
  if (!cell) return null;
  if (typeof cell.f === "string" && cell.f !== "") return cell.f;
  if (cell.v === null || cell.v === undefined || cell.v === "") return null;
  return String(cell.v);
}

export interface GvizRow {
  index: number;
  values: Record<string, string | null>;
  /** Valor crudo `v`, necesario para fechas tipo `Date(2026,10,29)`. */
  raw: Record<string, unknown>;
}

export function rows(payload: GvizPayload): GvizRow[] {
  const cols = columns(payload);
  return payload.table.rows.map((row, index) => {
    const values: Record<string, string | null> = {};
    const raw: Record<string, unknown> = {};
    cols.forEach((label, i) => {
      const cell = row.c?.[i] ?? null;
      values[label] = cellText(cell);
      raw[label] = cell?.v ?? null;
    });
    return { index, values, raw };
  });
}
