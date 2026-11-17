/**
 * La superficie MCP: cuatro tools, y están congeladas a propósito.
 *
 * `list_collections` / `search` / `get` / `source_status` cubren todo el
 * catálogo. Sumar datos nuevos (una colección, o una fuente más dentro de una
 * colección existente) es registrar un descriptor en `collections/index.ts`: no
 * cambia ni el nombre ni el schema de ninguna tool, así que un cliente que ya
 * tiene `tools/list` cacheado sigue sirviendo sin reconectar.
 *
 * El precio de tener `filters` abierto en el schema es que la validación pasa a
 * runtime (`validateFilters`); a cambio, los errores devuelven los valores
 * válidos y el modelo se corrige en una llamada.
 */
import { z } from "zod";
import { SERVER_TAGLINE } from "./branding.js";
import {
  CATALOG_VERSION,
  COLLECTION_IDS,
  COLLECTIONS,
  findCollection,
} from "./collections/index.js";
import {
  type Collection,
  type CollectionDescriptor,
  type SearchRequest,
  validateFilters,
} from "./collections.js";
import { TZ } from "./config.js";
import { DataError, isDataError } from "./errors.js";
import { parseId } from "./ids.js";

/** Los datos cargados, por colección. `null` = la fuente no está disponible. */
export type Snapshot = Record<string, unknown | null>;

export interface ToolOutput {
  data: Record<string, unknown>;
  /** Colección que sirvió la respuesta: define el crédito del envelope. */
  collection?: string | undefined;
  isError?: boolean;
}

export interface ToolDef<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  inputShape: Shape;
  handler: (snapshot: Snapshot, args: z.infer<z.ZodObject<Shape>>) => ToolOutput;
}

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/* ------------------------------------------------------------ envelope ----- */

function sourcesOf(snapshot: Snapshot, collection: Collection<unknown>) {
  const store = snapshot[collection.descriptor.id];
  return store === null || store === undefined ? [] : collection.sources(store);
}

/**
 * Envoltorio común a todas las respuestas: siempre la misma forma, con el
 * crédito a cada fuente y la huella del catálogo.
 */
export function envelope(
  snapshot: Snapshot,
  payload: Record<string, unknown>,
  collectionId?: string | undefined,
): Record<string, unknown> {
  const involved =
    collectionId === undefined
      ? COLLECTIONS
      : COLLECTIONS.filter((c) => c.descriptor.id === collectionId);

  const sources = involved.flatMap((c) => sourcesOf(snapshot, c));
  const notes = involved.flatMap((c) => c.descriptor.notes ?? []);
  const freshest = sources.map((s) => s.data_as_of).filter((v): v is string => v !== null);

  return {
    service: SERVER_TAGLINE,
    ...(collectionId === undefined ? {} : { collection: collectionId }),
    sources,
    timezone: TZ,
    data_as_of: freshest.length === 0 ? null : freshest.sort().at(-1),
    catalog_version: CATALOG_VERSION,
    ...(notes.length === 0 ? {} : { notes }),
    ...payload,
  };
}

/* ----------------------------------------------------------- paginación ----- */

/** Cursor opaco: es un offset codificado, y se trata como opaco desde afuera. */
export function encodeCursor(offset: number): string {
  return btoa(`o:${offset}`).replace(/=+$/, "");
}

export function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  try {
    const text = atob(cursor);
    const match = /^o:(\d+)$/.exec(text);
    if (!match) throw new Error("formato");
    return Number(match[1]);
  } catch {
    throw new DataError("invalid_cursor", "El cursor no es válido", {
      hint: "Usá tal cual el next_cursor de la respuesta anterior, o omitilo para empezar de cero.",
    });
  }
}

/* ------------------------------------------------------------- helpers ----- */

function storeOf(snapshot: Snapshot, collection: Collection<unknown>): unknown {
  const store = snapshot[collection.descriptor.id];
  if (store === null || store === undefined) {
    throw new DataError(
      "source_unavailable",
      `La colección "${collection.descriptor.id}" no está disponible en este momento`,
      { hint: "Probá source_status para ver el estado de cada fuente." },
    );
  }
  return store;
}

function assertSupported(descriptor: CollectionDescriptor, request: SearchRequest): void {
  const { supports } = descriptor;
  if (request.near && !supports.near) {
    throw new DataError(
      "unsupported",
      `La colección "${descriptor.id}" no soporta búsqueda por cercanía`,
      { hint: `Soporta: ${supports.near ? "near" : "texto y filtros"}.` },
    );
  }
  if (request.query !== undefined && !supports.text) {
    throw new DataError("unsupported", `La colección "${descriptor.id}" no soporta texto libre`);
  }
  if (request.date !== undefined && supports.date === "none") {
    throw new DataError("unsupported", `La colección "${descriptor.id}" no filtra por fecha`);
  }
  if (request.group_by !== undefined && !supports.group_by.includes(request.group_by)) {
    throw new DataError(
      "unsupported",
      `"${request.group_by}" no es una clave de agregación de "${descriptor.id}"`,
      { valid_values: [...supports.group_by] },
    );
  }
  if (request.sort !== undefined && !supports.sort.includes(request.sort)) {
    throw new DataError("unsupported", `"${request.sort}" no es un orden de "${descriptor.id}"`, {
      valid_values: [...supports.sort],
    });
  }
}

function describe(
  collection: Collection<unknown>,
  snapshot: Snapshot,
  include: string[],
): Record<string, unknown> {
  const { descriptor } = collection;
  const store = snapshot[descriptor.id] ?? null;
  const base: Record<string, unknown> = {
    id: descriptor.id,
    title: descriptor.title,
    description: descriptor.description,
    record: descriptor.record,
    available: store !== null,
    data_as_of: store === null ? null : collection.dataAsOf(store),
    supports: descriptor.supports,
    filters: descriptor.filters,
    ...(descriptor.notes === undefined ? {} : { notes: descriptor.notes }),
  };
  if (include.includes("sources"))
    base["sources"] = store === null ? [] : collection.sources(store);
  if (include.includes("examples") && descriptor.examples) base["examples"] = descriptor.examples;
  if (include.includes("taxonomies") && store !== null && collection.taxonomies) {
    base["taxonomies"] = collection.taxonomies(store);
  }
  return base;
}

/** Envuelve el handler para traducir `DataError` a la forma única de error. */
function define<Shape extends z.ZodRawShape>(def: ToolDef<Shape>): ToolDef<z.ZodRawShape> {
  const wrapped: ToolDef<Shape> = {
    ...def,
    handler: (snapshot, args) => {
      try {
        return def.handler(snapshot, args);
      } catch (err) {
        if (isDataError(err)) return { data: { error: err.toPayload() }, isError: true };
        throw err;
      }
    },
  };
  return wrapped as unknown as ToolDef<z.ZodRawShape>;
}

/* --------------------------------------------------------------- tools ----- */

const INCLUDE_SECTIONS = ["sources", "examples", "taxonomies"] as const;

const dateShape = z
  .object({
    from: z.string().optional().describe("aaaa-mm-dd, aaaa-mm-ddThh:mm o un token de la colección"),
    to: z.string().optional(),
    include_past: z.boolean().optional().default(false),
  })
  .optional();

const nearShape = z
  .object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    radius_km: z.number().min(0.1).max(50).optional(),
  })
  .optional()
  .describe("punto de referencia; ordena por distancia y recorta por radio");

export const TOOLS: ToolDef<z.ZodRawShape>[] = [
  define({
    name: "list_collections",
    title: "Catálogo de datos",
    description:
      "Qué datos públicos de Córdoba hay disponibles: colecciones, filtros que acepta cada una, " +
      "taxonomías, fuentes y frescura. Llamala si no reconocés una colección o un filtro: el " +
      "catálogo crece sin que cambien las tools.",
    inputShape: {
      collection: z
        .string()
        .optional()
        .describe(`id de colección (${COLLECTION_IDS.join(", ")}); omitilo para listar todas`),
      include: z
        .array(z.enum(INCLUDE_SECTIONS))
        .optional()
        .describe("secciones extra; filtros, soporte y frescura vienen siempre"),
    },
    handler: (snapshot, args) => {
      const include = (args.include as string[] | undefined) ?? [];
      const only = args.collection as string | undefined;
      const list = only === undefined ? COLLECTIONS : [findCollection(only)];
      return {
        data: {
          count: list.length,
          collections: list.map((c) => describe(c, snapshot, include)),
        },
      };
    },
  }),

  define({
    name: "search",
    title: "Buscar datos",
    description:
      "Busca registros en una colección por texto, fechas, filtros propios de la colección y " +
      `cercanía a un punto. Colecciones: ${COLLECTION_IDS.join(", ")}. Los filtros válidos de ` +
      "cada una salen de list_collections, y un filtro desconocido devuelve la lista de válidos.",
    inputShape: {
      collection: z.string().describe(`id de colección (${COLLECTION_IDS.join(", ")})`),
      query: z.string().optional().describe("texto libre"),
      date: dateShape,
      near: nearShape,
      filters: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('filtros de la colección, p. ej. {"category":"musica","free_only":true}'),
      source: z.string().optional().describe("limita a una fuente; por defecto consulta todas"),
      group_by: z.string().optional().describe("clave de agregación declarada por la colección"),
      sort: z.string().optional().describe("clave de orden declarada por la colección"),
      fields: z.enum(["summary", "full"]).optional().default("summary"),
      limit: z.number().int().min(1).max(MAX_LIMIT).optional().default(DEFAULT_LIMIT),
      cursor: z.string().optional().describe("next_cursor de la respuesta anterior"),
    },
    handler: (snapshot, args) => {
      const collection = findCollection(args.collection);
      const store = storeOf(snapshot, collection);
      const request: SearchRequest = {
        query: args.query as string | undefined,
        date: args.date as SearchRequest["date"],
        near: args.near as SearchRequest["near"],
        filters: {},
        source: args.source as string | undefined,
        group_by: args.group_by as string | undefined,
        sort: args.sort as string | undefined,
        fields: ((args.fields as string | undefined) ?? "summary") as "summary" | "full",
        now: new Date(),
      };
      assertSupported(collection.descriptor, request);
      request.filters = validateFilters(
        collection.descriptor,
        (args.filters as Record<string, unknown> | undefined) ?? {},
      );

      const outcome = collection.search(store, request);
      const limit = (args.limit as number | undefined) ?? DEFAULT_LIMIT;
      const offset = decodeCursor(args.cursor as string | undefined);
      const page = outcome.rows.slice(offset, offset + limit);
      const nextOffset = offset + page.length;

      return {
        collection: collection.descriptor.id,
        data: {
          ...(outcome.meta ?? {}),
          count: page.length,
          total: outcome.rows.length,
          truncated: nextOffset < outcome.rows.length,
          ...(nextOffset < outcome.rows.length ? { next_cursor: encodeCursor(nextOffset) } : {}),
          ...(outcome.groups === undefined ? {} : { groups: outcome.groups }),
          items: page,
        },
      };
    },
  }),

  define({
    name: "get",
    title: "Traer registros por id",
    description:
      "Trae registros completos por id, sin truncar. El id lleva prefijo de colección y fuente " +
      "(p. ej. eventos:turismo_muni:9f3c1a2b4d5e), que es lo que devuelve search.",
    inputShape: {
      ids: z.array(z.string()).min(1).max(50).describe("ids con prefijo de colección"),
      expand: z
        .array(z.string())
        .optional()
        .describe("datos derivados declarados por la colección, p. ej. next_duty_dates"),
    },
    handler: (snapshot, args) => {
      const expand = (args.expand as string[] | undefined) ?? [];
      // Guardamos el id tal como vino: lo que falte se devuelve con la misma
      // forma en que lo pidieron, no con una reconstruida.
      const byCollection = new Map<string, { local: string; raw: string }[]>();
      const unresolved: string[] = [];

      for (const raw of args.ids as string[]) {
        const parsed = parseId(raw);
        const id =
          parsed.collection === null ? resolveBare(snapshot, parsed.local) : parsed.collection;
        if (id === null) {
          unresolved.push(raw);
          continue;
        }
        const list = byCollection.get(id) ?? [];
        list.push({ local: parsed.local, raw });
        byCollection.set(id, list);
      }

      const records: Record<string, unknown>[] = [];
      const missing: string[] = [...unresolved];
      let single: string | undefined;

      for (const [collectionId, asked] of byCollection) {
        const collection = findCollection(collectionId);
        const unknownExpand = expand.filter(
          (e) => !collection.descriptor.supports.expand.includes(e),
        );
        if (unknownExpand.length > 0) {
          throw new DataError(
            "unsupported",
            `"${unknownExpand[0]}" no es un expand de "${collectionId}"`,
            { valid_values: [...collection.descriptor.supports.expand] },
          );
        }
        const store = storeOf(snapshot, collection);
        const outcome = collection.get(
          store,
          asked.map((item) => item.local),
          expand,
        );
        records.push(...outcome.found);
        missing.push(
          ...outcome.missing.map(
            (local) =>
              asked.find((item) => item.local === local)?.raw ?? `${collectionId}:${local}`,
          ),
        );
        single = byCollection.size === 1 ? collectionId : undefined;
      }

      if (records.length === 0) {
        throw new DataError("not_found", "Ninguno de esos ids existe", {
          hint: "Los ids salen de search; no son estables si la fuente cambia el título o la fecha.",
          valid_values: missing,
        });
      }

      return {
        collection: single,
        data: { count: records.length, records, ...(missing.length === 0 ? {} : { missing }) },
      };
    },
  }),

  define({
    name: "source_status",
    title: "Estado de las fuentes",
    description:
      "Último run de cada fuente, resultado de la validación, conteos y frescura. Sirve para " +
      "saber si un dato está al día antes de confiar en él.",
    inputShape: {
      collection: z.string().optional().describe("id de colección; omitilo para todas"),
    },
    handler: (snapshot, args) => {
      const only = args.collection as string | undefined;
      const list = only === undefined ? COLLECTIONS : [findCollection(only)];
      return {
        data: {
          collections: list.map((collection) => {
            const store = snapshot[collection.descriptor.id] ?? null;
            return {
              id: collection.descriptor.id,
              title: collection.descriptor.title,
              available: store !== null,
              sources: store === null ? [] : collection.sources(store),
              ...(store === null
                ? { error: "La fuente no está cargada" }
                : collection.status(store)),
            };
          }),
        },
      };
    },
  }),
];

/**
 * Un id pelado (sin prefijo) es compatibilidad con los ids anteriores: se busca
 * en todas las colecciones cargadas y sólo resuelve si no es ambiguo.
 */
function resolveBare(snapshot: Snapshot, local: string): string | null {
  const hits = COLLECTIONS.filter((collection) => {
    const store = snapshot[collection.descriptor.id];
    if (store === null || store === undefined) return false;
    return collection.get(store, [local], []).found.length > 0;
  });
  if (hits.length === 1) return (hits[0] as Collection<unknown>).descriptor.id;
  if (hits.length > 1) {
    throw new DataError("invalid_id", `El id "${local}" existe en más de una colección`, {
      hint: "Usá el id con prefijo, como lo devuelve search.",
      valid_values: hits.map((c) => `${c.descriptor.id}:${local}`),
    });
  }
  return null;
}

/** Recurso MCP único: el catálogo. La URI no cambia nunca; su contenido crece. */
export const CATALOG_RESOURCE = {
  name: "catalog",
  uri: "cordoba://catalog",
  title: "Catálogo de datos públicos de Córdoba",
  mimeType: "application/json",
  read: (snapshot: Snapshot): Record<string, unknown> => {
    const tool = TOOLS.find((t) => t.name === "list_collections") as ToolDef<z.ZodRawShape>;
    return envelope(snapshot, tool.handler(snapshot, { include: ["sources", "examples"] }).data);
  },
} as const;
