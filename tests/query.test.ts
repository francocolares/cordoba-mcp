import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDataset } from "../packages/core/src/dataset.js";
import type { Event } from "../packages/core/src/models.js";
import { contentHash } from "../packages/core/src/normalize.js";
import {
  eventsOn,
  getEvent,
  listCategories,
  SUMMARY_DESCRIPTION_MAX,
  searchEvents,
  thisWeekend,
  toSummary,
} from "../packages/core/src/query.js";
import { serializeEvents } from "../packages/core/src/store.js";

const NOW = new Date("2026-11-12T15:00:00Z"); // jueves 12:00 en Córdoba

function ev(partial: Partial<Event> & { id: string; start: string }): Event {
  const base = {
    title: partial.title ?? `Evento ${partial.id}`,
    description: partial.description ?? null,
    category_raw: partial.category_raw ?? null,
    category: partial.category ?? ("musica" as const),
    start: partial.start,
    end: partial.end ?? null,
    all_day: partial.all_day ?? false,
    venue: partial.venue ?? null,
    organizer: partial.organizer ?? null,
    ticket_url: partial.ticket_url ?? null,
    price_type: partial.price_type ?? ("pago" as const),
    price_raw: partial.price_raw ?? "Con costo",
    is_permanent: false,
    permanent_schedule: null,
    image_url: null,
    status_raw: "1",
  };
  return {
    id: partial.id,
    source: "turismo_muni",
    source_row: 0,
    ...base,
    active: partial.active ?? true,
    first_seen: "2026-11-01T00:00:00.000Z",
    last_seen: "2026-11-12T09:00:00.000Z",
    content_hash: contentHash(base),
  };
}

const events: Event[] = [
  ev({ id: "pasado", title: "Show viejo", start: "2026-11-01T21:00:00-03:00" }),
  ev({
    id: "hoy1",
    title: "Música a Ciegas",
    start: "2026-11-12T21:00:00-03:00",
    venue: "Plaza España",
    price_type: "gratis",
    price_raw: "0",
    category: "musica",
  }),
  ev({
    id: "manana",
    title: "Visita nocturna al Museo San Alberto",
    start: "2026-11-13T20:00:00-03:00",
    category: "visita_guiada",
    venue: "Museo San Alberto",
    description: "x".repeat(400),
  }),
  ev({
    id: "finde",
    title: "Feria del Libro",
    start: "2026-11-14T10:00:00-03:00",
    end: "2026-11-14T22:00:00-03:00",
    category: "feria",
    price_type: "gratis",
    price_raw: "0",
  }),
  ev({
    id: "rango",
    title: "Pabellón Tornú",
    start: "2026-11-05T20:00:00-03:00",
    end: "2026-11-30T23:00:00-03:00",
    category: "teatro",
  }),
  ev({ id: "proximo", title: "Después del finde", start: "2026-11-20T20:00:00-03:00" }),
  ev({ id: "baja", title: "Dado de baja", start: "2026-11-13T20:00:00-03:00", active: false }),
];

describe("searchEvents", () => {
  it("excluye pasados, inactivos y ordena por start", () => {
    const found = searchEvents(events, {}, NOW);
    expect(found.map((e) => e.id)).toEqual(["rango", "hoy1", "manana", "finde", "proximo"]);
  });

  it("incluye pasados con include_past", () => {
    expect(searchEvents(events, { include_past: true }, NOW).map((e) => e.id)[0]).toBe("pasado");
  });

  it("busca sin tildes en título, lugar y descripción", () => {
    expect(searchEvents(events, { query: "musica" }, NOW).map((e) => e.id)).toEqual(["hoy1"]);
    expect(searchEvents(events, { query: "PABELLON tornu" }, NOW).map((e) => e.id)).toEqual([
      "rango",
    ]);
    expect(searchEvents(events, { query: "museo san alberto" }, NOW).map((e) => e.id)).toEqual([
      "manana",
    ]);
  });

  it("filtra por categoría, gratis y limit", () => {
    expect(searchEvents(events, { category: "teatro" }, NOW).map((e) => e.id)).toEqual(["rango"]);
    expect(searchEvents(events, { free_only: true }, NOW).map((e) => e.id)).toEqual([
      "hoy1",
      "finde",
    ]);
    expect(searchEvents(events, { limit: 2 }, NOW)).toHaveLength(2);
  });

  it("filtra por rango de fechas inclusive", () => {
    const found = searchEvents(events, { date_from: "2026-11-13", date_to: "2026-11-14" }, NOW);
    expect(found.map((e) => e.id)).toEqual(["rango", "manana", "finde"]);
    expect(
      searchEvents(events, { date_from: "hoy", date_to: "hoy" }, NOW).map((e) => e.id),
    ).toEqual(["rango", "hoy1"]);
  });
});

describe("eventsOn", () => {
  it("devuelve los de ese día, incluidos los de rango", () => {
    expect(eventsOn(events, "2026-11-13", NOW).map((e) => e.id)).toEqual(["rango", "manana"]);
  });

  it('acepta "hoy" y "mañana"', () => {
    expect(eventsOn(events, "hoy", NOW).map((e) => e.id)).toEqual(["rango", "hoy1"]);
    expect(eventsOn(events, "mañana", NOW).map((e) => e.id)).toEqual(["rango", "manana"]);
  });

  it("devuelve vacío si la fecha es ilegible", () => {
    expect(eventsOn(events, "cualquier cosa", NOW)).toEqual([]);
  });
});

describe("thisWeekend", () => {
  it("va del viernes 18:00 al domingo 23:59", () => {
    const { range, events: found } = thisWeekend(events, {}, NOW);
    expect(range).toEqual({ from: "2026-11-13T18:00:00-03:00", to: "2026-11-15T23:59:00-03:00" });
    expect(found.map((e) => e.id)).toEqual(["rango", "manana", "finde"]);
  });

  it("con free_only deja sólo los gratis", () => {
    expect(thisWeekend(events, { free_only: true }, NOW).events.map((e) => e.id)).toEqual([
      "finde",
    ]);
  });
});

describe("list_categories / get_event / summary", () => {
  it("cuenta sólo activos", () => {
    expect(listCategories(events)).toEqual([
      { category: "musica", count: 3 },
      { category: "feria", count: 1 },
      { category: "teatro", count: 1 },
      { category: "visita_guiada", count: 1 },
    ]);
  });

  it("get_event por id", () => {
    expect(getEvent(events, "finde")?.title).toBe("Feria del Libro");
    expect(getEvent(events, "noexiste")).toBeNull();
  });

  it("el summary trunca la descripción a 300 caracteres", () => {
    const summary = toSummary(events.find((e) => e.id === "manana")!);
    expect(summary.description).toHaveLength(SUMMARY_DESCRIPTION_MAX);
    expect(summary.description?.endsWith("…")).toBe(true);
  });
});

describe("loadDataset", () => {
  it("lee events.jsonl de un path local", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cordoba-ds-"));
    const file = join(dir, "events.jsonl");
    await writeFile(file, serializeEvents(events), "utf8");
    const data = await loadDataset({ path: file });
    expect(data.events).toHaveLength(events.length);
    expect(data.status).toBeNull();
    expect(data.data_as_of).toBe("2026-11-12T09:00:00.000Z");
  });

  it("lee status.json de al lado y toma data_as_of de last_run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cordoba-ds-"));
    await writeFile(join(dir, "events.jsonl"), serializeEvents(events), "utf8");
    await writeFile(
      join(dir, "status.json"),
      JSON.stringify({ last_run: "2026-11-12T12:00:00.000Z", counts: { total: 7 } }),
      "utf8",
    );
    const data = await loadDataset({ path: join(dir, "events.jsonl") });
    expect(data.status?.last_run).toBe("2026-11-12T12:00:00.000Z");
    expect(data.data_as_of).toBe("2026-11-12T12:00:00.000Z");
  });
});
