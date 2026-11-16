import { describe, expect, it } from "vitest";
import type { Pharmacy, TurnoCalendar } from "../packages/core/src/farmacias/models.js";
import { envelope, type Snapshot, TOOLS } from "../packages/core/src/tools.js";

const days: Record<string, number> = {};
for (let day = 1; day <= 31; day++) {
  days[`2026-01-${String(day).padStart(2, "0")}`] = day === 1 ? 30 : day - 1;
}

const calendar: TurnoCalendar = {
  year: 2026,
  cycle_length: 30,
  anchor: { date: "2026-01-02", turno: 1 },
  days,
  source_file: "data/raw/farmacias/turnero-2026.xlsx",
  content_hash: "abc",
  ingested_at: "2026-01-01T00:00:00.000Z",
};

const pharmacy = (over: Partial<Pharmacy> & { id: string }): Pharmacy => ({
  source: "colegio_farmaceuticos",
  turno: 1,
  section: 1,
  name: "FARMACIA",
  address: "Av. Colón 100",
  barrio: "Centro",
  raw: "FARMACIA - Av. Colón 100 Bº Centro",
  parse_confidence: "alta",
  lat: null,
  lon: null,
  geocode_precision: "ninguna",
  geocode_label: null,
  active: true,
  first_seen: "2026-01-01T00:00:00.000Z",
  last_seen: "2026-01-01T00:00:00.000Z",
  content_hash: "h",
  ...over,
});

const snapshot: Snapshot = {
  agenda: { events: [], status: null, data_as_of: "2026-01-01T00:00:00.000Z" },
  farmacias: {
    pharmacies: [
      pharmacy({ id: "a", turno: 2, name: "CENTRO", lat: -31.42, lon: -64.19 }),
      pharmacy({
        id: "b",
        turno: 2,
        section: 4,
        name: "ALBERDI",
        barrio: "Alberdi",
        address: "Av. Colón 1881",
        raw: "ALBERDI - Av. Colón 1881 Bº Alberdi",
        lat: -31.41,
        lon: -64.21,
      }),
      pharmacy({ id: "c", turno: 3, name: "OTRO TURNO" }),
    ],
    calendars: [calendar],
    status: null,
    data_as_of: "2026-01-02T00:00:00.000Z",
  },
};

const sinFarmacias: Snapshot = { agenda: snapshot.agenda, farmacias: null };

const tool = (name: string) => {
  const found = TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`no existe el tool ${name}`);
  return found;
};

const call = (name: string, args: Record<string, unknown> = {}, snap: Snapshot = snapshot) =>
  tool(name).handler(snap, args);

describe("los tools de farmacias", () => {
  it("están registrados junto a los de la agenda", () => {
    expect(TOOLS.map((t) => t.name)).toEqual([
      "search_events",
      "events_on",
      "this_weekend",
      "get_event",
      "list_categories",
      "source_status",
      "pharmacies_on_duty",
      "pharmacies_near",
      "duty_turno_on",
      "find_pharmacy",
      "get_pharmacy",
    ]);
  });

  it("pharmacies_on_duty devuelve el turno del día y sus farmacias", () => {
    const { data } = call("pharmacies_on_duty", { date: "2026-01-03" });
    expect(data).toMatchObject({ turno: 2, service_date: "2026-01-03", count: 2 });
    expect(data["window"]).toMatchObject({
      from: "2026-01-03T08:30:00-03:00",
      to: "2026-01-04T08:30:00-03:00",
    });
  });

  it("filtra por barrio", () => {
    const { data } = call("pharmacies_on_duty", { date: "2026-01-03", barrio: "alberdi" });
    expect(data["count"]).toBe(1);
  });

  it("ordena por distancia cuando le pasan coordenadas", () => {
    const { data } = call("pharmacies_on_duty", {
      date: "2026-01-03",
      near_lat: -31.41,
      near_lon: -64.211,
    });
    const list = data["pharmacies"] as { id: string; distance_km: number }[];
    expect(list.map((p) => p.id)).toEqual(["b", "a"]);
    expect(list[0]!.distance_km).toBeLessThan(list[1]!.distance_km);
  });

  it("pharmacies_near respeta el radio y reporta las no geocodificadas", () => {
    const { data } = call("pharmacies_near", {
      lat: -31.41,
      lon: -64.211,
      radius_km: 1,
      date: "2026-01-03",
    });
    expect(data["count"]).toBe(1);
    expect(data["sin_geocodificar"]).toBe(0);
  });

  it("duty_turno_on resume por sección sin listar todo", () => {
    const { data } = call("duty_turno_on", { date: "2026-01-03" });
    expect(data).toMatchObject({ turno: 2, count: 2 });
    expect(data["sections"]).toEqual([
      { section: 1, count: 1 },
      { section: 4, count: 1 },
    ]);
  });

  it("find_pharmacy dice en qué turno está y cuándo le toca", () => {
    const { data } = call("find_pharmacy", { query: "alberdi" });
    const list = data["pharmacies"] as {
      turno: number;
      next_duty_dates: { date: string; derived: boolean }[];
    }[];
    expect(list).toHaveLength(1);
    expect(list[0]!.turno).toBe(2);
    expect(list[0]!.next_duty_dates.length).toBeGreaterThan(0);
  });

  it("get_pharmacy marca error con un id que no existe", () => {
    expect(call("get_pharmacy", { id: "nope" }).isError).toBe(true);
    expect(call("get_pharmacy", { id: "a" }).isError).toBeUndefined();
  });

  it("avisa cuando piden un año sin turnero cargado", () => {
    const result = call("pharmacies_on_duty", { date: "2030-05-05" });
    expect(result.isError).toBeUndefined(); // se proyecta con el ciclo
    expect(result.data["turno_derivado_del_ciclo"]).toBe(true);
  });

  it("falla con una fecha que no se puede interpretar", () => {
    const result = call("pharmacies_on_duty", { date: "el jueves que viene" });
    expect(result.isError).toBe(true);
  });

  it("sin dataset de farmacias responde error, no se cuelga", () => {
    for (const name of [
      "pharmacies_on_duty",
      "pharmacies_near",
      "duty_turno_on",
      "find_pharmacy",
      "get_pharmacy",
    ]) {
      const result = call(name, { lat: -31.4, lon: -64.2, query: "x", id: "a" }, sinFarmacias);
      expect(result.isError).toBe(true);
      expect(String(result.data["error"])).toContain("farmacias");
    }
  });
});

describe("el envelope", () => {
  it("acredita a la fuente de cada tool", () => {
    const agenda = envelope(tool("search_events"), snapshot, {});
    expect(String(agenda["source"])).toContain("Municipalidad");
    expect(agenda["data_as_of"]).toBe("2026-01-01T00:00:00.000Z");

    const farmacias = envelope(tool("pharmacies_on_duty"), snapshot, {});
    expect(String(farmacias["source"])).toContain("Colegio de Farmacéuticos");
    expect(farmacias["data_as_of"]).toBe("2026-01-02T00:00:00.000Z");
  });

  it("declara la ventana de guardia y el disclaimer en cada respuesta", () => {
    const farmacias = envelope(tool("pharmacies_on_duty"), snapshot, {});
    expect(farmacias["turno_window"]).toMatchObject({ confirmed: false, duration_hours: 24 });
    expect(String(farmacias["disclaimer"])).toContain("no figura en la planilla");
  });
});

describe("source_status", () => {
  it("reporta las dos fuentes", () => {
    const { data } = call("source_status");
    expect(data["agenda"]).toMatchObject({ events_in_file: 0 });
    expect(data["farmacias"]).toMatchObject({ pharmacies_in_file: 3, years: [2026] });
  });

  it("dice si falta el dataset de farmacias", () => {
    const { data } = call("source_status", {}, sinFarmacias);
    expect(String((data["farmacias"] as Record<string, unknown>)["error"])).toContain("no está");
  });
});
