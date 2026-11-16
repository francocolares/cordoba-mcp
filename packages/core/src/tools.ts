import { z } from "zod";
import { AGENDA_URL, SOURCE_NAME, TZ } from "./config.js";
import { isoDate, resolveDateInput, todayInCordoba } from "./datetime.js";
import {
  FARMACIAS_DISCLAIMER,
  FARMACIAS_SOURCE_NAME,
  FARMACIAS_SOURCE_URL,
  TURNO_DURATION_HOURS,
  TURNO_START,
  TURNO_WINDOW_CONFIRMED,
} from "./farmacias/config.js";
import type { FarmaciasStatus, Pharmacy, TurnoCalendar } from "./farmacias/models.js";
import {
  findPharmacies,
  getPharmacy,
  matchesBarrio,
  nearest,
  nextDutyDates,
  pharmaciesOfTurno,
  resolveServiceDate,
  toPharmacySummary,
  turnoOn,
  turnoWindow,
} from "./farmacias/query.js";
import { Category, type Event, type RunStatus } from "./models.js";
import {
  eventsOn,
  getEvent,
  listCategories,
  searchEvents,
  thisWeekend,
  toSummary,
} from "./query.js";

/** Dataset de la agenda turística. */
export interface AgendaDataset {
  events: Event[];
  status: RunStatus | null;
  data_as_of: string;
}

/** Dataset de las guardias de farmacias. */
export interface FarmaciasDataset {
  pharmacies: Pharmacy[];
  calendars: TurnoCalendar[];
  status: FarmaciasStatus | null;
  data_as_of: string;
}

/**
 * Todo lo que los tools necesitan saber, sin tocar el filesystem. Cada fuente
 * es un dataset aparte: comparten el servidor MCP, no el modelo de datos.
 */
export interface Snapshot {
  agenda: AgendaDataset;
  /** null cuando el dataset no está cargado (el tool lo reporta como error). */
  farmacias: FarmaciasDataset | null;
}

/** @deprecated Quedó como alias del dataset de la agenda. */
export type AgendaSnapshot = AgendaDataset;

export type DatasetId = "agenda" | "farmacias";

export interface ToolOutput {
  data: Record<string, unknown>;
  isError?: boolean;
}

export interface ToolDef<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  /** De qué fuente sale: define el crédito y el `data_as_of` de la respuesta. */
  dataset: DatasetId;
  inputShape: Shape;
  handler: (snapshot: Snapshot, args: z.infer<z.ZodObject<Shape>>) => ToolOutput;
}

export const TURNO_WINDOW_INFO = {
  start_time: TURNO_START,
  duration_hours: TURNO_DURATION_HOURS,
  confirmed: TURNO_WINDOW_CONFIRMED,
} as const;

/** Envoltorio común a todas las respuestas, con crédito a la fuente que la sirvió. */
export function envelope(
  tool: Pick<ToolDef, "dataset">,
  snapshot: Snapshot,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (tool.dataset === "farmacias") {
    return {
      source: FARMACIAS_SOURCE_NAME,
      source_url: FARMACIAS_SOURCE_URL,
      timezone: TZ,
      data_as_of: snapshot.farmacias?.data_as_of ?? null,
      turno_window: TURNO_WINDOW_INFO,
      disclaimer: FARMACIAS_DISCLAIMER,
      ...payload,
    };
  }
  return {
    source: SOURCE_NAME,
    source_url: AGENDA_URL,
    timezone: TZ,
    data_as_of: snapshot.agenda.data_as_of,
    ...payload,
  };
}

function define<Shape extends z.ZodRawShape>(def: ToolDef<Shape>): ToolDef<z.ZodRawShape> {
  return def as unknown as ToolDef<z.ZodRawShape>;
}

/* ------------------------------------------------------------- agenda ----- */

const searchShape = {
  query: z.string().optional().describe("texto libre (título, descripción, lugar, organizador)"),
  category: Category.optional().describe("categoría canónica"),
  date_from: z.string().optional().describe('aaaa-mm-dd, "hoy" o "mañana"'),
  date_to: z.string().optional().describe('aaaa-mm-dd, "hoy" o "mañana"'),
  free_only: z.boolean().optional().default(false),
  include_past: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(100).optional().default(20),
};

const AGENDA_TOOLS: ToolDef<z.ZodRawShape>[] = [
  define({
    name: "search_events",
    title: "Buscar eventos",
    description:
      "Busca eventos de la agenda turística de Córdoba por texto, categoría, rango de fechas y si son gratis.",
    dataset: "agenda",
    inputShape: searchShape,
    handler: (snapshot, args) => {
      const found = searchEvents(snapshot.agenda.events, args);
      return { data: { count: found.length, events: found.map(toSummary) } };
    },
  }),
  define({
    name: "events_on",
    title: "Eventos de un día",
    description:
      'Eventos de un día puntual en hora de Córdoba. Acepta "hoy", "mañana" o aaaa-mm-dd.',
    dataset: "agenda",
    inputShape: { date: z.string().describe('aaaa-mm-dd, "hoy" o "mañana"') },
    handler: (snapshot, { date }) => {
      const found = eventsOn(snapshot.agenda.events, date);
      return { data: { date, count: found.length, events: found.map(toSummary) } };
    },
  }),
  define({
    name: "this_weekend",
    title: "Este fin de semana",
    description: "Eventos del viernes 18:00 al domingo 23:59 del próximo (o actual) fin de semana.",
    dataset: "agenda",
    inputShape: {
      free_only: z.boolean().optional().default(false),
      category: Category.optional(),
    },
    handler: (snapshot, args) => {
      const { range, events } = thisWeekend(snapshot.agenda.events, args);
      return { data: { range, count: events.length, events: events.map(toSummary) } };
    },
  }),
  define({
    name: "get_event",
    title: "Detalle de evento",
    description: "Devuelve un evento completo por id, sin truncar la descripción.",
    dataset: "agenda",
    inputShape: { id: z.string().describe("id estable del evento") },
    handler: (snapshot, { id }) => {
      const event = getEvent(snapshot.agenda.events, id);
      if (!event) return { data: { id, error: "No existe un evento con ese id" }, isError: true };
      // El link ?evento=N no es estable (es el índice de fila), así que linkeamos la agenda.
      return { data: { event, link: AGENDA_URL } };
    },
  }),
  define({
    name: "list_categories",
    title: "Categorías",
    description: "Categorías canónicas con la cantidad de eventos activos de cada una.",
    dataset: "agenda",
    inputShape: {},
    handler: (snapshot) => ({ data: { categories: listCategories(snapshot.agenda.events) } }),
  }),
  define({
    name: "source_status",
    title: "Estado de las fuentes",
    description: "Último run de cada fuente, resultado de la validación y conteos.",
    dataset: "agenda",
    inputShape: {},
    handler: (snapshot) => ({
      data: {
        agenda: {
          status: snapshot.agenda.status,
          events_in_file: snapshot.agenda.events.length,
          data_as_of: snapshot.agenda.data_as_of,
        },
        farmacias: snapshot.farmacias
          ? {
              status: snapshot.farmacias.status,
              pharmacies_in_file: snapshot.farmacias.pharmacies.length,
              years: snapshot.farmacias.calendars.map((c) => c.year),
              data_as_of: snapshot.farmacias.data_as_of,
              turno_window: TURNO_WINDOW_INFO,
            }
          : { error: "El dataset de farmacias no está cargado" },
      },
    }),
  }),
];

/* ---------------------------------------------------------- farmacias ----- */

const NO_DATASET = {
  data: {
    error:
      "El dataset de farmacias no está cargado. Corré `cordoba-scraper farmacias ingest` o revisá AGENDA_DATA_PATH.",
  },
  isError: true,
} satisfies ToolOutput;

const dateArg = z.string().optional().describe('"ahora" (default), "hoy", "mañana" o aaaa-mm-dd');

const latArg = z.number().min(-90).max(90);
const lonArg = z.number().min(-180).max(180);

/** Resuelve fecha -> turno y lista. Lo comparten los tools de guardia. */
function dutyFor(
  farmacias: FarmaciasDataset,
  dateInput: string | undefined,
  now = new Date(),
):
  | { error: string }
  | {
      lookup: NonNullable<ReturnType<typeof turnoOn>>;
      window: ReturnType<typeof turnoWindow>;
      pharmacies: Pharmacy[];
    } {
  const date = resolveServiceDate(dateInput, now);
  if (!date) return { error: `No pude interpretar la fecha "${dateInput ?? ""}"` };
  const lookup = turnoOn(farmacias.calendars, date);
  if (!lookup) {
    return {
      error: `No hay turnero cargado para ${isoDate(date)}. Años disponibles: ${
        farmacias.calendars.map((c) => c.year).join(", ") || "ninguno"
      }`,
    };
  }
  return {
    lookup,
    window: turnoWindow(date),
    pharmacies: pharmaciesOfTurno(farmacias.pharmacies, lookup.turno),
  };
}

const FARMACIAS_TOOLS: ToolDef<z.ZodRawShape>[] = [
  define({
    name: "pharmacies_on_duty",
    title: "Farmacias de turno",
    description:
      "Farmacias de turno (guardia obligatoria) en Córdoba para un día. Si se pasan coordenadas, " +
      "las ordena por distancia. El horario de la guardia es un supuesto declarado en la respuesta.",
    dataset: "farmacias",
    inputShape: {
      date: dateArg,
      barrio: z.string().optional().describe("filtra por barrio o calle"),
      near_lat: latArg.optional().describe("latitud de referencia para ordenar por distancia"),
      near_lon: lonArg.optional().describe("longitud de referencia"),
      limit: z.number().int().min(1).max(200).optional().default(25),
    },
    handler: (snapshot, args) => {
      const farmacias = snapshot.farmacias;
      if (!farmacias) return NO_DATASET;
      const duty = dutyFor(farmacias, args.date as string | undefined);
      if ("error" in duty) return { data: { error: duty.error }, isError: true };

      const barrio = args.barrio as string | undefined;
      const filtered = barrio
        ? duty.pharmacies.filter((p) => matchesBarrio(p, barrio))
        : duty.pharmacies;
      const limit = (args.limit as number) ?? 25;
      const lat = args.near_lat as number | undefined;
      const lon = args.near_lon as number | undefined;

      const list =
        lat !== undefined && lon !== undefined
          ? nearest(filtered, { lat, lon, limit }).map((row) =>
              toPharmacySummary(row.pharmacy, row.distance_km),
            )
          : filtered.slice(0, limit).map((p) => toPharmacySummary(p));

      return {
        data: {
          turno: duty.lookup.turno,
          turno_derivado_del_ciclo: duty.lookup.derived,
          service_date: duty.window.service_date,
          window: { from: duty.window.from, to: duty.window.to },
          total_del_turno: duty.pharmacies.length,
          count: list.length,
          sin_geocodificar:
            lat !== undefined && lon !== undefined
              ? filtered.filter((p) => p.lat === null).length
              : undefined,
          pharmacies: list,
        },
      };
    },
  }),
  define({
    name: "pharmacies_near",
    title: "Farmacias de turno cerca",
    description:
      "Farmacias de turno dentro de un radio de un punto, ordenadas por distancia en línea recta.",
    dataset: "farmacias",
    inputShape: {
      lat: latArg.describe("latitud del punto de referencia"),
      lon: lonArg.describe("longitud del punto de referencia"),
      radius_km: z.number().min(0.1).max(50).optional().default(3),
      date: dateArg,
      limit: z.number().int().min(1).max(50).optional().default(10),
    },
    handler: (snapshot, args) => {
      const farmacias = snapshot.farmacias;
      if (!farmacias) return NO_DATASET;
      const duty = dutyFor(farmacias, args.date as string | undefined);
      if ("error" in duty) return { data: { error: duty.error }, isError: true };

      const found = nearest(duty.pharmacies, {
        lat: args.lat as number,
        lon: args.lon as number,
        radius_km: (args.radius_km as number) ?? 3,
        limit: (args.limit as number) ?? 10,
      });
      return {
        data: {
          turno: duty.lookup.turno,
          service_date: duty.window.service_date,
          window: { from: duty.window.from, to: duty.window.to },
          radius_km: (args.radius_km as number) ?? 3,
          count: found.length,
          total_del_turno: duty.pharmacies.length,
          sin_geocodificar: duty.pharmacies.filter((p) => p.lat === null).length,
          pharmacies: found.map((row) => toPharmacySummary(row.pharmacy, row.distance_km)),
        },
      };
    },
  }),
  define({
    name: "duty_turno_on",
    title: "Turno de un día",
    description:
      "Qué número de turno (1 a 30) está de guardia un día, con el detalle por sección. " +
      "Útil para entender la rotación sin listar las 850 farmacias.",
    dataset: "farmacias",
    inputShape: { date: dateArg },
    handler: (snapshot, args) => {
      const farmacias = snapshot.farmacias;
      if (!farmacias) return NO_DATASET;
      const duty = dutyFor(farmacias, args.date as string | undefined);
      if ("error" in duty) return { data: { error: duty.error }, isError: true };

      const sections = new Map<number | null, number>();
      for (const pharmacy of duty.pharmacies) {
        sections.set(pharmacy.section, (sections.get(pharmacy.section) ?? 0) + 1);
      }
      return {
        data: {
          turno: duty.lookup.turno,
          turno_derivado_del_ciclo: duty.lookup.derived,
          service_date: duty.window.service_date,
          window: { from: duty.window.from, to: duty.window.to },
          count: duty.pharmacies.length,
          sections: [...sections.entries()]
            .sort((a, b) => (a[0] ?? 99) - (b[0] ?? 99))
            .map(([section, count]) => ({ section, count })),
        },
      };
    },
  }),
  define({
    name: "find_pharmacy",
    title: "Buscar farmacia",
    description:
      "Busca una farmacia por nombre, calle o barrio y dice en qué turno está y cuándo le toca " +
      "guardia las próximas veces.",
    dataset: "farmacias",
    inputShape: {
      query: z.string().min(2).describe("nombre, calle o barrio"),
      limit: z.number().int().min(1).max(50).optional().default(10),
    },
    handler: (snapshot, args) => {
      const farmacias = snapshot.farmacias;
      if (!farmacias) return NO_DATASET;
      const today = todayInCordoba();
      const found = findPharmacies(
        farmacias.pharmacies.filter((p) => p.active),
        args.query as string,
        (args.limit as number) ?? 10,
      );
      return {
        data: {
          query: args.query,
          count: found.length,
          pharmacies: found.map((pharmacy) => ({
            ...toPharmacySummary(pharmacy),
            next_duty_dates: nextDutyDates(farmacias.calendars, pharmacy.turno, today, 3),
          })),
        },
      };
    },
  }),
  define({
    name: "get_pharmacy",
    title: "Detalle de farmacia",
    description: "Devuelve una farmacia completa por id, con sus próximas guardias.",
    dataset: "farmacias",
    inputShape: { id: z.string().describe("id estable de la farmacia") },
    handler: (snapshot, { id }) => {
      const farmacias = snapshot.farmacias;
      if (!farmacias) return NO_DATASET;
      const pharmacy = getPharmacy(farmacias.pharmacies, id as string);
      if (!pharmacy) {
        return { data: { id, error: "No existe una farmacia con ese id" }, isError: true };
      }
      return {
        data: {
          pharmacy,
          next_duty_dates: nextDutyDates(farmacias.calendars, pharmacy.turno, todayInCordoba(), 5),
        },
      };
    },
  }),
];

/**
 * Definición única de los tools: la usan el servidor stdio (apps/mcp) y el
 * Worker de Cloudflare (apps/worker) para no duplicar lógica ni descripciones.
 */
export const TOOLS: ToolDef<z.ZodRawShape>[] = [...AGENDA_TOOLS, ...FARMACIAS_TOOLS];

export const STATUS_RESOURCE = {
  name: "status",
  uri: "agenda://status",
  title: "Estado de las fuentes",
  mimeType: "application/json",
  read: (snapshot: Snapshot): Record<string, unknown> => {
    const tool = TOOLS.find((t) => t.name === "source_status")!;
    return envelope(tool, snapshot, tool.handler(snapshot, {}).data);
  },
} as const;

/** Fecha de referencia para los tools que aceptan "hoy"/"mañana". */
export const resolveDate = resolveDateInput;
