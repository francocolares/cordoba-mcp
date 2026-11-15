import { z } from "zod";
import { AGENDA_URL, SOURCE_NAME, TZ } from "./config.js";
import { Category, type Event, type RunStatus } from "./models.js";
import {
  eventsOn,
  getEvent,
  listCategories,
  searchEvents,
  thisWeekend,
  toSummary,
} from "./query.js";

/** Lo mínimo que un tool necesita saber del dataset (sin tocar el filesystem). */
export interface AgendaSnapshot {
  events: Event[];
  status: RunStatus | null;
  data_as_of: string;
}

export interface ToolOutput {
  data: Record<string, unknown>;
  isError?: boolean;
}

export interface ToolDef<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  inputShape: Shape;
  handler: (snapshot: AgendaSnapshot, args: z.infer<z.ZodObject<Shape>>) => ToolOutput;
}

/** Envoltorio común a todas las respuestas, con crédito a la fuente. */
export function envelope(
  snapshot: AgendaSnapshot,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return {
    source: SOURCE_NAME,
    source_url: AGENDA_URL,
    timezone: TZ,
    data_as_of: snapshot.data_as_of,
    ...payload,
  };
}

function define<Shape extends z.ZodRawShape>(def: ToolDef<Shape>): ToolDef<z.ZodRawShape> {
  return def as unknown as ToolDef<z.ZodRawShape>;
}

const searchShape = {
  query: z.string().optional().describe("texto libre (título, descripción, lugar, organizador)"),
  category: Category.optional().describe("categoría canónica"),
  date_from: z.string().optional().describe('aaaa-mm-dd, "hoy" o "mañana"'),
  date_to: z.string().optional().describe('aaaa-mm-dd, "hoy" o "mañana"'),
  free_only: z.boolean().optional().default(false),
  include_past: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(100).optional().default(20),
};

/**
 * Definición única de los tools: la usan el servidor stdio (apps/mcp) y el
 * Worker de Cloudflare (apps/worker) para no duplicar lógica ni descripciones.
 */
export const TOOLS: ToolDef<z.ZodRawShape>[] = [
  define({
    name: "search_events",
    title: "Buscar eventos",
    description:
      "Busca eventos de la agenda turística de Córdoba por texto, categoría, rango de fechas y si son gratis.",
    inputShape: searchShape,
    handler: (snapshot, args) => {
      const found = searchEvents(snapshot.events, args);
      return { data: { count: found.length, events: found.map(toSummary) } };
    },
  }),
  define({
    name: "events_on",
    title: "Eventos de un día",
    description:
      'Eventos de un día puntual en hora de Córdoba. Acepta "hoy", "mañana" o aaaa-mm-dd.',
    inputShape: { date: z.string().describe('aaaa-mm-dd, "hoy" o "mañana"') },
    handler: (snapshot, { date }) => {
      const found = eventsOn(snapshot.events, date);
      return { data: { date, count: found.length, events: found.map(toSummary) } };
    },
  }),
  define({
    name: "this_weekend",
    title: "Este fin de semana",
    description: "Eventos del viernes 18:00 al domingo 23:59 del próximo (o actual) fin de semana.",
    inputShape: {
      free_only: z.boolean().optional().default(false),
      category: Category.optional(),
    },
    handler: (snapshot, args) => {
      const { range, events } = thisWeekend(snapshot.events, args);
      return { data: { range, count: events.length, events: events.map(toSummary) } };
    },
  }),
  define({
    name: "get_event",
    title: "Detalle de evento",
    description: "Devuelve un evento completo por id, sin truncar la descripción.",
    inputShape: { id: z.string().describe("id estable del evento") },
    handler: (snapshot, { id }) => {
      const event = getEvent(snapshot.events, id);
      if (!event) return { data: { id, error: "No existe un evento con ese id" }, isError: true };
      // El link ?evento=N no es estable (es el índice de fila), así que linkeamos la agenda.
      return { data: { event, link: AGENDA_URL } };
    },
  }),
  define({
    name: "list_categories",
    title: "Categorías",
    description: "Categorías canónicas con la cantidad de eventos activos de cada una.",
    inputShape: {},
    handler: (snapshot) => ({ data: { categories: listCategories(snapshot.events) } }),
  }),
  define({
    name: "source_status",
    title: "Estado de la fuente",
    description: "Último run del scraper, resultado de la validación y conteos.",
    inputShape: {},
    handler: (snapshot) => ({
      data: { status: snapshot.status, events_in_file: snapshot.events.length },
    }),
  }),
];

export const STATUS_RESOURCE = {
  name: "status",
  uri: "agenda://status",
  title: "Estado de la fuente",
  mimeType: "application/json",
  read: (snapshot: AgendaSnapshot): Record<string, unknown> =>
    envelope(snapshot, { status: snapshot.status, events_in_file: snapshot.events.length }),
} as const;
