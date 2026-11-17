/**
 * Colección `eventos`. Hoy la alimenta una sola fuente (la Agenda Turística de
 * la Municipalidad), pero el contrato ya es multi-fuente: agregar Córdoba
 * Turismo o Agencia Córdoba Cultura es sumar filas al store y una entrada en
 * `sources()`, sin tocar las tools ni este descriptor.
 */

import { type Collection, countBy, defineCollection, type SearchOutcome } from "../collections.js";
import { AGENDA_URL, SOURCE_ID, SOURCE_NAME } from "../config.js";
import { isoDate, resolveDateInput } from "../datetime.js";
import { DataError } from "../errors.js";
import { formatId } from "../ids.js";
import { Category, type Event, type RunStatus } from "../models.js";
import { listCategories, searchEvents, thisWeekend, toSummary } from "../query.js";

export interface EventosStore {
  events: Event[];
  status: RunStatus | null;
  data_as_of: string;
}

const ALL = Number.MAX_SAFE_INTEGER;

const row = (event: Event, fields: "summary" | "full"): Record<string, unknown> => {
  const id = formatId("eventos", event.source, event.id);
  if (fields === "summary") return { ...toSummary(event), id };
  // El link ?evento=N de la agenda es el índice de fila y no es estable: linkeamos la agenda.
  return { ...event, id, link: AGENDA_URL };
};

export const eventos: Collection<unknown> = defineCollection<EventosStore>({
  descriptor: {
    id: "eventos",
    title: "Eventos y agenda cultural",
    description:
      "Eventos de la agenda de Córdoba: música, teatro, ferias, visitas guiadas, museos y más, " +
      "con fecha, lugar, precio y link de entradas cuando la fuente lo publica.",
    record: "evento",
    supports: {
      text: true,
      near: false,
      date: "range",
      date_tokens: ["hoy", "mañana", "fin_de_semana", "aaaa-mm-dd"],
      group_by: ["category"],
      sort: ["start"],
      expand: [],
    },
    filters: [
      {
        name: "category",
        type: "enum",
        values: Category.options,
        description: "categoría canónica del evento",
      },
      {
        name: "free_only",
        type: "boolean",
        default: false,
        description: "sólo los eventos con entrada gratuita",
      },
      {
        name: "include_inactive",
        type: "boolean",
        default: false,
        description: "incluir los eventos que la fuente dio de baja",
      },
    ],
    examples: [
      'search(collection:"eventos", date:{from:"fin_de_semana"}, filters:{free_only:true})',
      'search(collection:"eventos", query:"tango", date:{from:"hoy", to:"2026-12-31"})',
      'search(collection:"eventos", group_by:"category")',
    ],
  },

  sources: (store) => [
    {
      id: SOURCE_ID,
      name: SOURCE_NAME,
      url: AGENDA_URL,
      license: "sin términos publicados",
      data_as_of: store.data_as_of,
    },
  ],

  dataAsOf: (store) => store.data_as_of,

  status: (store) => ({
    status: store.status,
    records: store.events.length,
    active: store.events.filter((e) => e.active).length,
    data_as_of: store.data_as_of,
  }),

  taxonomies: (store) => ({ category: listCategories(store.events) }),

  search: (store, request): SearchOutcome => {
    if (request.near) {
      throw new DataError(
        "unsupported",
        "La colección eventos todavía no tiene coordenadas: no se puede filtrar por cercanía",
        { hint: 'Los venues geocodificados van a entrar como colección "venues".' },
      );
    }

    const from = request.date?.from;
    const to = request.date?.to;
    const category = request.filters["category"] as string | undefined;
    const freeOnly = request.filters["free_only"] === true;
    const includeInactive = request.filters["include_inactive"] === true;

    let matched: Event[];
    let resolved: Record<string, unknown>;

    if (from === "fin_de_semana") {
      const weekend = thisWeekend(store.events, { free_only: freeOnly, category }, request.now);
      matched = weekend.events;
      resolved = { from: weekend.range.from, to: weekend.range.to, token: "fin_de_semana" };
    } else {
      matched = searchEvents(
        store.events,
        {
          ...(request.query === undefined ? {} : { query: request.query }),
          ...(category === undefined ? {} : { category }),
          ...(from === undefined ? {} : { date_from: from }),
          ...(to === undefined ? {} : { date_to: to }),
          free_only: freeOnly,
          include_past: request.date?.include_past === true,
          include_inactive: includeInactive,
          limit: ALL,
        },
        request.now,
      );
      resolved = {
        from: from === undefined ? null : resolveIso(from, request.now),
        to: to === undefined ? null : resolveIso(to, request.now),
      };
    }

    if (request.source !== undefined) {
      matched = matched.filter((e) => e.source === request.source);
    }

    const groups =
      request.group_by === "category" ? countBy(matched, (e) => e.category) : undefined;

    return {
      rows: matched.map((event) => row(event, request.fields)),
      meta: { resolved },
      ...(groups === undefined ? {} : { groups }),
    };
  },

  dump: (store) => ({ jsonl: store.events }),

  get: (store, localIds, _expand) => {
    const found: Record<string, unknown>[] = [];
    const missing: string[] = [];
    for (const id of localIds) {
      const event = store.events.find((e) => e.id === id);
      if (event) found.push(row(event, "full"));
      else missing.push(id);
    }
    return { found, missing };
  },
});

function resolveIso(input: string, now: Date): string | null {
  const date = resolveDateInput(input, now);
  return date ? isoDate(date) : null;
}
