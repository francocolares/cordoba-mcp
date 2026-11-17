/**
 * El registro de colecciones: el único lugar donde se declara qué datos hay.
 *
 * Una colección es un tipo de registro (eventos, farmacias_turno, …) y puede
 * alimentarse de varias fuentes; una fuente puede alimentar varias colecciones.
 * El eje de las tools es la colección, no la fuente: así sumar un organismo
 * nuevo a `eventos` no cambia nada de lo que el cliente ve.
 *
 * Todo lo que una colección sabe de sí misma (filtros, taxonomías, qué soporta,
 * notas) vive en su `descriptor`, que `list_collections` publica tal cual. Por
 * eso una colección nueva NO toca el schema de las tools: es una fila más acá.
 */
import { DataError } from "./errors.js";

export type FilterType = "string" | "boolean" | "number" | "enum";

/** Un filtro declarado. `search` valida `filters` contra esta lista en runtime. */
export interface FilterSpec {
  name: string;
  type: FilterType;
  description: string;
  values?: readonly string[];
  min?: number;
  max?: number;
  default?: unknown;
}

export interface SourceInfo {
  id: string;
  name: string;
  url: string;
  license: string;
  /** ISO del dato más fresco de esa fuente; null si no está cargada. */
  data_as_of: string | null;
}

/** Cómo interpreta las fechas la colección. */
export type DateMode = "range" | "single" | "none";

export interface CollectionDescriptor {
  id: string;
  title: string;
  description: string;
  /** Nombre del registro en singular, para las descripciones generadas. */
  record: string;
  supports: {
    text: boolean;
    near: boolean;
    date: DateMode;
    /** Tokens relativos que acepta en `date.from` / `date.to`. */
    date_tokens: readonly string[];
    group_by: readonly string[];
    sort: readonly string[];
    expand: readonly string[];
  };
  filters: readonly FilterSpec[];
  /** Llamadas de ejemplo, en texto. Las sirve `list_collections`. */
  examples?: readonly string[];
  /** Advertencias del dominio (supuestos, precisión). Van a `notes`. */
  notes?: readonly string[];
}

export interface SearchRequest {
  query?: string | undefined;
  date?: { from?: string | undefined; to?: string | undefined; include_past?: boolean } | undefined;
  near?: { lat: number; lon: number; radius_km?: number | undefined } | undefined;
  filters: Record<string, unknown>;
  source?: string | undefined;
  group_by?: string | undefined;
  sort?: string | undefined;
  fields: "summary" | "full";
  now: Date;
}

/**
 * La colección devuelve TODAS las filas que matchean, ya ordenadas y ya
 * mapeadas a summary/full. El recorte (`limit`/`cursor`) y el `total` los hace
 * el handler, así la paginación es idéntica en todas las colecciones.
 */
export interface SearchOutcome {
  rows: Record<string, unknown>[];
  /** Campos propios del resultado (turno, window, resolved…). */
  meta?: Record<string, unknown>;
  groups?: { key: string | number | null; count: number }[];
}

export interface GetOutcome {
  found: Record<string, unknown>[];
  /** Ids locales que no existen. */
  missing: string[];
}

export interface Collection<S> {
  descriptor: CollectionDescriptor;
  /** Fuentes que la alimentan, con su frescura. */
  sources(store: S): SourceInfo[];
  dataAsOf(store: S): string | null;
  status(store: S): Record<string, unknown>;
  /** Taxonomías con conteos (categorías, secciones…). */
  taxonomies?(store: S): Record<string, unknown>;
  search(store: S, request: SearchRequest): SearchOutcome;
  get(store: S, localIds: string[], expand: string[]): GetOutcome;
  /**
   * Volcado crudo, para las rutas HTTP `/api/{collection}*`. `jsonl` son los
   * registros tal como se guardan; `extras` son archivos auxiliares de la
   * colección (p. ej. el turnero), ruteados por su nombre.
   */
  dump(store: S): { jsonl: unknown[]; extras?: Record<string, unknown> };
}

/** Igual que `define()` para tools: borra el genérico para poder listarlas. */
export function defineCollection<S>(collection: Collection<S>): Collection<unknown> {
  return collection as unknown as Collection<unknown>;
}

/* --------------------------------------------------------- validación ----- */

/**
 * Valida `filters` contra los declarados por la colección. Es la contracara de
 * tener `filters` abierto en el JSON Schema: lo que no valida el schema lo
 * valida acá, y el error devuelve los valores válidos para que el modelo se
 * corrija solo.
 */
export function validateFilters(
  descriptor: CollectionDescriptor,
  filters: Record<string, unknown>,
): Record<string, unknown> {
  const declared = new Map(descriptor.filters.map((f) => [f.name, f]));
  const out: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;
    const spec = declared.get(name);
    if (!spec) {
      throw new DataError(
        "unknown_filter",
        `La colección "${descriptor.id}" no tiene el filtro "${name}"`,
        {
          hint: `Filtros válidos: ${[...declared.keys()].join(", ") || "ninguno"}`,
          valid_values: [...declared.keys()],
        },
      );
    }
    out[name] = coerce(spec, value, descriptor.id);
  }

  for (const spec of descriptor.filters) {
    if (spec.default !== undefined && out[spec.name] === undefined) out[spec.name] = spec.default;
  }
  return out;
}

function coerce(spec: FilterSpec, value: unknown, collection: string): unknown {
  const bad = (detail: string, valid?: unknown[]) =>
    new DataError(
      "invalid_filter_value",
      `Valor inválido para "${spec.name}" en "${collection}": ${detail}`,
      { hint: spec.description, ...(valid === undefined ? {} : { valid_values: valid }) },
    );

  switch (spec.type) {
    case "boolean": {
      if (typeof value === "boolean") return value;
      if (value === "true") return true;
      if (value === "false") return false;
      throw bad("se espera true o false", [true, false]);
    }
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) throw bad("se espera un número");
      if (spec.min !== undefined && n < spec.min) throw bad(`el mínimo es ${spec.min}`);
      if (spec.max !== undefined && n > spec.max) throw bad(`el máximo es ${spec.max}`);
      return n;
    }
    case "enum": {
      const text = String(value);
      const values = spec.values ?? [];
      if (!values.includes(text)) throw bad(`no está en la lista`, [...values]);
      return text;
    }
    default: {
      if (typeof value !== "string") throw bad("se espera texto");
      return value;
    }
  }
}

/** Conteo por clave, para los `group_by` de cualquier colección. */
export function countBy<T>(
  rows: T[],
  key: (row: T) => string | number | null,
): { key: string | number | null; count: number }[] {
  const counts = new Map<string | number | null, number>();
  for (const item of rows) {
    const k = key(item);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([k, count]) => ({ key: k, count }))
    .sort((a, b) => b.count - a.count);
}
