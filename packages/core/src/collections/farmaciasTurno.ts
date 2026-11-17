/**
 * Colección `farmacias_turno`: el padrón de farmacias con su rotación de
 * guardias obligatorias.
 *
 * Dos consultas distintas sobre el mismo padrón, discriminadas por el filtro
 * declarado `on_duty`:
 *   - `on_duty: true` (default): las que están de turno en la fecha pedida.
 *   - `on_duty: false`: busca en todo el padrón y devuelve la próxima guardia
 *     de cada una (lo que antes hacía `find_pharmacy`).
 */
import { type Collection, countBy, defineCollection, type SearchOutcome } from "../collections.js";
import { isoDate, todayInCordoba } from "../datetime.js";
import { DataError } from "../errors.js";
import {
  FARMACIAS_DISCLAIMER,
  FARMACIAS_SOURCE_ID,
  FARMACIAS_SOURCE_NAME,
  FARMACIAS_SOURCE_URL,
  MAX_SECTION,
  TURNO_CYCLE_LENGTH,
  TURNO_DURATION_HOURS,
  TURNO_START,
  TURNO_WINDOW_CONFIRMED,
} from "../farmacias/config.js";
import type { FarmaciasStatus, Pharmacy, TurnoCalendar } from "../farmacias/models.js";
import {
  findPharmacies,
  matchesBarrio,
  nearest,
  nextDutyDates,
  pharmaciesOfTurno,
  resolveServiceDate,
  toPharmacySummary,
  turnoOn,
  turnoWindow,
} from "../farmacias/query.js";
import { formatId } from "../ids.js";

const ALL = Number.MAX_SAFE_INTEGER;

export interface FarmaciasTurnoStore {
  pharmacies: Pharmacy[];
  calendars: TurnoCalendar[];
  status: FarmaciasStatus | null;
  data_as_of: string;
}

export const TURNO_WINDOW_INFO = {
  start_time: TURNO_START,
  duration_hours: TURNO_DURATION_HOURS,
  confirmed: TURNO_WINDOW_CONFIRMED,
} as const;

const row = (
  pharmacy: Pharmacy,
  fields: "summary" | "full",
  distanceKm?: number,
): Record<string, unknown> => {
  const id = formatId("farmacias_turno", pharmacy.source, pharmacy.id);
  if (fields === "summary") return { ...toPharmacySummary(pharmacy, distanceKm), id };
  return {
    ...pharmacy,
    id,
    ...(distanceKm === undefined ? {} : { distance_km: Math.round(distanceKm * 100) / 100 }),
  };
};

export const farmaciasTurno: Collection<unknown> = defineCollection<FarmaciasTurnoStore>({
  descriptor: {
    id: "farmacias_turno",
    title: "Farmacias de turno",
    description:
      "Padrón de farmacias de la ciudad de Córdoba con la rotación de guardias obligatorias " +
      `(ciclo de ${TURNO_CYCLE_LENGTH} turnos, uno por día). Devuelve las que están de turno en ` +
      "una fecha, filtradas por barrio o ordenadas por distancia a un punto.",
    record: "farmacia",
    supports: {
      text: true,
      near: true,
      date: "single",
      date_tokens: ["ahora", "hoy", "mañana", "aaaa-mm-dd"],
      group_by: ["seccion", "turno"],
      sort: ["section", "distance"],
      expand: ["next_duty_dates"],
    },
    filters: [
      {
        name: "on_duty",
        type: "boolean",
        default: true,
        description:
          "true (default): sólo las de turno en la fecha pedida. false: busca en todo el padrón " +
          "y devuelve la próxima guardia de cada una",
      },
      { name: "barrio", type: "string", description: "filtra por barrio o calle" },
      {
        name: "turno",
        type: "number",
        min: 1,
        max: TURNO_CYCLE_LENGTH,
        description: "número de turno de la rotación",
      },
      {
        name: "seccion",
        type: "number",
        min: 1,
        max: MAX_SECTION,
        description: "sección de la ciudad que usa el Colegio",
      },
    ],
    examples: [
      'search(collection:"farmacias_turno", near:{lat:-31.42,lon:-64.18,radius_km:2})',
      'search(collection:"farmacias_turno", date:{from:"mañana"}, filters:{barrio:"Nueva Córdoba"})',
      'search(collection:"farmacias_turno", query:"del centro", filters:{on_duty:false})',
      'search(collection:"farmacias_turno", group_by:"seccion")',
    ],
    notes: [FARMACIAS_DISCLAIMER],
  },

  sources: (store) => [
    {
      id: FARMACIAS_SOURCE_ID,
      name: FARMACIAS_SOURCE_NAME,
      url: FARMACIAS_SOURCE_URL,
      license: "sin términos publicados",
      data_as_of: store.data_as_of,
    },
  ],

  dataAsOf: (store) => store.data_as_of,

  status: (store) => ({
    status: store.status,
    records: store.pharmacies.length,
    active: store.pharmacies.filter((p) => p.active).length,
    geocoded: store.pharmacies.filter((p) => p.lat !== null).length,
    years: store.calendars.map((c) => c.year),
    turno_window: TURNO_WINDOW_INFO,
    data_as_of: store.data_as_of,
  }),

  taxonomies: (store) => ({
    seccion: countBy(
      store.pharmacies.filter((p) => p.active),
      (p) => p.section,
    ),
    turno: countBy(
      store.pharmacies.filter((p) => p.active),
      (p) => p.turno,
    ),
  }),

  search: (store, request): SearchOutcome => {
    const onDuty = request.filters["on_duty"] !== false;
    const barrio = request.filters["barrio"] as string | undefined;
    const turnoFilter = request.filters["turno"] as number | undefined;
    const seccion = request.filters["seccion"] as number | undefined;
    const active = store.pharmacies.filter((p) => p.active);

    if (request.date?.to !== undefined && request.date.to !== request.date.from) {
      throw new DataError(
        "unsupported",
        "farmacias_turno consulta un día a la vez: usá date.from",
        { hint: "La guardia rota día por día; para varios días, una llamada por día." },
      );
    }

    let pool: Pharmacy[];
    const meta: Record<string, unknown> = {};

    if (onDuty) {
      const date = resolveServiceDate(request.date?.from, request.now);
      if (!date) {
        throw new DataError(
          "invalid_date",
          `No pude interpretar la fecha "${request.date?.from ?? ""}"`,
          { valid_values: ["ahora", "hoy", "mañana", "aaaa-mm-dd"] },
        );
      }
      const lookup = turnoOn(store.calendars, date);
      if (!lookup) {
        throw new DataError("source_unavailable", `No hay turnero cargado para ${isoDate(date)}`, {
          hint: `Años disponibles: ${store.calendars.map((c) => c.year).join(", ") || "ninguno"}`,
        });
      }
      const window = turnoWindow(date);
      pool = pharmaciesOfTurno(store.pharmacies, lookup.turno);
      meta["turno"] = lookup.turno;
      meta["derived_from_cycle"] = lookup.derived;
      meta["service_date"] = window.service_date;
      meta["window"] = { from: window.from, to: window.to };
      meta["turno_window"] = TURNO_WINDOW_INFO;
      meta["duty_total"] = pool.length;
      meta["resolved"] = { from: window.service_date, token: request.date?.from ?? "ahora" };
    } else {
      pool = request.query === undefined ? active : findPharmacies(active, request.query, ALL);
      meta["resolved"] = { from: isoDate(todayInCordoba(request.now)) };
    }

    if (onDuty && request.query !== undefined) {
      pool = findPharmacies(pool, request.query, ALL);
    }
    if (barrio !== undefined) pool = pool.filter((p) => matchesBarrio(p, barrio));
    if (turnoFilter !== undefined) pool = pool.filter((p) => p.turno === turnoFilter);
    if (seccion !== undefined) pool = pool.filter((p) => p.section === seccion);
    if (request.source !== undefined) pool = pool.filter((p) => p.source === request.source);

    const groups =
      request.group_by === "seccion"
        ? countBy(pool, (p) => p.section)
        : request.group_by === "turno"
          ? countBy(pool, (p) => p.turno)
          : undefined;

    // `next_duty_dates` se arma junto a la fila, no después por índice: con
    // `near` el orden y la cantidad cambian (las sin geocodificar quedan afuera).
    const today = todayInCordoba(request.now);
    const toRow = (pharmacy: Pharmacy, distanceKm?: number): Record<string, unknown> => {
      const base = row(pharmacy, request.fields, distanceKm);
      if (onDuty) return base;
      return {
        ...base,
        next_duty_dates: nextDutyDates(store.calendars, pharmacy.turno, today, 3),
      };
    };

    let rows: Record<string, unknown>[];
    if (request.near) {
      const near = nearest(pool, {
        lat: request.near.lat,
        lon: request.near.lon,
        ...(request.near.radius_km === undefined ? {} : { radius_km: request.near.radius_km }),
        limit: ALL,
      });
      meta["without_coords"] = pool.filter((p) => p.lat === null).length;
      rows = near.map((hit) => toRow(hit.pharmacy, hit.distance_km));
    } else {
      rows = pool.map((pharmacy) => toRow(pharmacy));
    }

    return { rows, meta, ...(groups === undefined ? {} : { groups }) };
  },

  dump: (store) => ({
    jsonl: store.pharmacies,
    extras: { "turnos.json": { calendars: store.calendars } },
  }),

  get: (store, localIds, expand) => {
    const found: Record<string, unknown>[] = [];
    const missing: string[] = [];
    const wantsDuty = expand.includes("next_duty_dates");
    for (const id of localIds) {
      const pharmacy = store.pharmacies.find((p) => p.id === id);
      if (!pharmacy) {
        missing.push(id);
        continue;
      }
      const full = row(pharmacy, "full");
      found.push(
        wantsDuty
          ? {
              ...full,
              next_duty_dates: nextDutyDates(store.calendars, pharmacy.turno, todayInCordoba(), 5),
            }
          : full,
      );
    }
    return { found, missing };
  },
});
