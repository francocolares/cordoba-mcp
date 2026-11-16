import { describe, expect, it } from "vitest";
import {
  expandAbbreviations,
  geocodeCandidates,
  geocodeMissing,
  geocodeOne,
  geocodeQuery,
  insideCordoba,
} from "../packages/core/src/farmacias/geocode.js";
import {
  geocodeWithGeoref,
  georefQueries,
  toEntry,
} from "../packages/core/src/farmacias/georef.js";
import type { Pharmacy, TurnoCalendar } from "../packages/core/src/farmacias/models.js";
import { PHARMACY_CONTENT_FIELDS } from "../packages/core/src/farmacias/models.js";
import { applyGeocode, pharmacyId } from "../packages/core/src/farmacias/normalize.js";
import {
  findPharmacies,
  haversineKm,
  matchesBarrio,
  nearest,
  nextDutyDates,
  pharmaciesOfTurno,
  resolveServiceDate,
  serviceDateAt,
  turnoByCycle,
  turnoOn,
  turnoWindow,
} from "../packages/core/src/farmacias/query.js";
import { mergeEntities } from "../packages/core/src/store.js";

/** Calendario mínimo: enero 2026 con el ciclo real (1/1 = turno 30). */
const days: Record<string, number> = {};
for (let day = 1; day <= 31; day++) {
  const turno = ((day - 2 + 30) % 30) + 1;
  days[`2026-01-${String(day).padStart(2, "0")}`] = day === 1 ? 30 : turno;
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

describe("turnoOn", () => {
  it("usa el calendario de la planilla cuando la fecha está", () => {
    expect(turnoOn([calendar], { year: 2026, month: 1, day: 1 })).toMatchObject({
      turno: 30,
      derived: false,
    });
    expect(turnoOn([calendar], { year: 2026, month: 1, day: 2 })).toMatchObject({
      turno: 1,
      derived: false,
    });
  });

  it("proyecta con el ciclo cuando el año no está cargado y lo avisa", () => {
    const lookup = turnoOn([calendar], { year: 2027, month: 3, day: 15 });
    expect(lookup?.derived).toBe(true);
    expect(lookup?.turno).toBe(turnoByCycle(calendar, { year: 2027, month: 3, day: 15 }));
    expect(lookup!.turno).toBeGreaterThanOrEqual(1);
    expect(lookup!.turno).toBeLessThanOrEqual(30);
  });

  it("sin calendarios no inventa nada", () => {
    expect(turnoOn([], { year: 2026, month: 1, day: 1 })).toBeNull();
  });
});

describe("la ventana de guardia", () => {
  it("arranca a la hora configurada y dura 24 horas", () => {
    const window = turnoWindow({ year: 2026, month: 1, day: 5 });
    expect(window.from).toBe("2026-01-05T08:30:00-03:00");
    expect(window.to).toBe("2026-01-06T08:30:00-03:00");
    expect(window.service_date).toBe("2026-01-05");
  });

  it("antes del inicio sigue de turno la farmacia del día anterior", () => {
    // 02:00 del 6 de enero en Córdoba = 05:00 UTC.
    const madrugada = new Date("2026-01-06T05:00:00Z");
    expect(serviceDateAt(madrugada)).toEqual({ year: 2026, month: 1, day: 5 });
    // 10:00 del 6 ya es el turno del 6.
    expect(serviceDateAt(new Date("2026-01-06T13:00:00Z"))).toEqual({
      year: 2026,
      month: 1,
      day: 6,
    });
  });

  it('"ahora" resuelve al día de guardia y las fechas explícitas no', () => {
    const madrugada = new Date("2026-01-06T05:00:00Z");
    expect(resolveServiceDate("ahora", madrugada)).toEqual({ year: 2026, month: 1, day: 5 });
    expect(resolveServiceDate(undefined, madrugada)).toEqual({ year: 2026, month: 1, day: 5 });
    expect(resolveServiceDate("2026-01-06", madrugada)).toEqual({ year: 2026, month: 1, day: 6 });
    expect(resolveServiceDate("cualquier cosa", madrugada)).toBeNull();
  });
});

describe("listas y distancias", () => {
  const list = [
    pharmacy({ id: "a", turno: 1, section: 2, name: "LEJOS", lat: -31.5, lon: -64.3 }),
    pharmacy({ id: "b", turno: 1, section: 1, name: "CERCA", lat: -31.42, lon: -64.19 }),
    pharmacy({ id: "c", turno: 1, section: 3, name: "SIN COORDENADAS" }),
    pharmacy({ id: "d", turno: 2, name: "OTRO TURNO", lat: -31.42, lon: -64.19 }),
    pharmacy({ id: "e", turno: 1, name: "DE BAJA", active: false }),
  ];

  it("filtra por turno, excluye inactivas y ordena por sección", () => {
    expect(pharmaciesOfTurno(list, 1).map((p) => p.id)).toEqual(["b", "a", "c"]);
  });

  it("ordena por distancia y deja afuera las que no tienen coordenadas", () => {
    const found = nearest(pharmaciesOfTurno(list, 1), { lat: -31.42, lon: -64.188, limit: 5 });
    expect(found.map((row) => row.pharmacy.id)).toEqual(["b", "a"]);
    expect(found[0]!.distance_km).toBeLessThan(1);
  });

  it("respeta el radio", () => {
    const found = nearest(pharmaciesOfTurno(list, 1), {
      lat: -31.42,
      lon: -64.188,
      radius_km: 1,
    });
    expect(found.map((row) => row.pharmacy.id)).toEqual(["b"]);
  });

  it("haversine da la distancia conocida entre dos puntos de Córdoba", () => {
    // Plaza San Martín -> Parque Sarmiento, ~2 km.
    const km = haversineKm({ lat: -31.4201, lon: -64.1888 }, { lat: -31.4305, lon: -64.1706 });
    expect(km).toBeGreaterThan(1.5);
    expect(km).toBeLessThan(2.5);
  });

  it("busca por nombre, calle o barrio sin tildes", () => {
    expect(findPharmacies(list, "cerca").map((p) => p.id)).toEqual(["b"]);
    expect(findPharmacies(list, "colon").length).toBeGreaterThan(0);
    expect(findPharmacies(list, "")).toEqual([]);
  });

  it("matchesBarrio mira barrio y dirección", () => {
    expect(matchesBarrio(list[0]!, "centro")).toBe(true);
    expect(matchesBarrio(list[0]!, "colon")).toBe(true);
    expect(matchesBarrio(list[0]!, "alberdi")).toBe(false);
  });
});

describe("nextDutyDates", () => {
  it("devuelve las próximas fechas del turno", () => {
    const dates = nextDutyDates([calendar], 5, { year: 2026, month: 1, day: 1 }, 2);
    expect(dates[0]).toEqual({ date: "2026-01-06", derived: false });
    expect(dates).toHaveLength(2);
    // La segunda cae en febrero, que este calendario de prueba no tiene: proyectada.
    expect(dates[1]!.derived).toBe(true);
  });
});

describe("ids y merge", () => {
  it("el id sale del crudo normalizado y es estable", () => {
    expect(pharmacyId("PONCE - Av. Gral. Paz 654 Bº Centro")).toBe(
      pharmacyId("ponce -  av. gral. paz 654 bº centro"),
    );
    expect(pharmacyId("A - 1")).not.toBe(pharmacyId("B - 1"));
  });

  it("un cambio de turno se registra como updated y no como alta", () => {
    const previous = [pharmacy({ id: "a", turno: 1, content_hash: "v1" })];
    const next = [pharmacy({ id: "a", turno: 9, content_hash: "v2" })];
    const result = mergeEntities(previous, next, "2026-02-01T00:00:00.000Z", {
      contentFields: PHARMACY_CONTENT_FIELDS,
      titleOf: (p) => p.name ?? p.raw,
    });
    expect(result.counts).toMatchObject({ added: 0, updated: 1, removed: 0, total: 1 });
    expect(result.changes[0]!.fields?.["turno"]).toEqual([1, 9]);
    expect(result.items[0]!.first_seen).toBe("2026-01-01T00:00:00.000Z");
  });

  it("una farmacia que sale de la planilla queda inactiva una sola vez", () => {
    const previous = [pharmacy({ id: "a" })];
    const first = mergeEntities(previous, [], "2026-02-01T00:00:00.000Z", {
      contentFields: PHARMACY_CONTENT_FIELDS,
      titleOf: (p) => p.name ?? p.raw,
    });
    expect(first.counts.removed).toBe(1);
    const second = mergeEntities(first.items, [], "2026-02-02T00:00:00.000Z", {
      contentFields: PHARMACY_CONTENT_FIELDS,
      titleOf: (p) => p.name ?? p.raw,
    });
    expect(second.counts.removed).toBe(0);
    expect(second.items[0]!.active).toBe(false);
  });
});

describe("geocoding", () => {
  it("limpia local, manzana y esquina de la dirección", () => {
    expect(geocodeQuery("Av. Colón 2412 PB Loc. 1 esq. Sarmiento")).toBe("Av. Colón 2412");
    expect(geocodeQuery("Rio Negro Mz 79 Lote 10 Local 3")).toBe("Rio Negro");
  });

  it("expande las abreviaturas que hacen fallar a Nominatim", () => {
    expect(expandAbbreviations("Rep. De Siria 602")).toBe("República de Siria 602");
    expect(expandAbbreviations("Av. Dnto Alvarez 8720")).toBe("Avenida Donato Alvarez 8720");
    expect(expandAbbreviations("Bv.Ocampo 234")).toBe("Boulevard Ocampo 234");
  });

  it("genera candidatos de más a menos específico, sin repetir", () => {
    const candidates = geocodeCandidates({ address: "Av. Colón 2806", barrio: "Alberdi" });
    expect(candidates.map((c) => c.query)).toEqual([
      "Avenida Colón 2806, Alberdi",
      "Avenida Colón 2806",
      "Avenida Colón",
      "Barrio Alberdi",
    ]);
  });

  it("rechaza resultados fuera de la caja de Córdoba", () => {
    expect(insideCordoba({ lat: "-31.42", lon: "-64.18" })).toBe(true);
    expect(insideCordoba({ lat: "-34.60", lon: "-58.38" })).toBe(false); // Buenos Aires
  });

  it("baja la precisión a calle si el geocoder no resolvió la altura", () => {
    const result = geocodeOne(
      { address: "Av. Colón 2806", barrio: null },
      {
        sleep: async () => {},
        search: async () => [{ lat: "-31.42", lon: "-64.2", display_name: "Avenida Colón" }],
      },
      "2026-01-01T00:00:00.000Z",
    );
    return result.then((entry) => {
      expect(entry.precision).toBe("calle");
      expect(entry.lat).toBeCloseTo(-31.42);
    });
  });

  it("cae al barrio cuando la dirección no resuelve", async () => {
    const entry = await geocodeOne(
      { address: "Calle Que No Existe 9999", barrio: "Centro" },
      {
        sleep: async () => {},
        search: async (query) =>
          query.startsWith("Barrio")
            ? [{ lat: "-31.42", lon: "-64.18", display_name: "Centro" }]
            : [],
      },
    );
    expect(entry.precision).toBe("barrio");
  });

  it("no vuelve a pedir lo que ya está en la cache", async () => {
    const asked: string[] = [];
    const result = await geocodeMissing(
      [
        { address: "Av. Colón 100", barrio: "Centro" },
        { address: "Av. Colón 200", barrio: "Centro" },
      ],
      {
        "av. colon 100|centro": {
          lat: -31.4,
          lon: -64.2,
          precision: "exacta",
          label: null,
          query: "x",
          at: "2026-01-01T00:00:00.000Z",
        },
      },
      {
        sleep: async () => {},
        search: async (query) => {
          asked.push(query);
          return [{ lat: "-31.41", lon: "-64.21", address: { house_number: "200" } }];
        },
      },
    );
    expect(result.skipped).toBe(1);
    expect(result.resolved).toBe(1);
    expect(asked.every((q) => q.includes("200"))).toBe(true);
  });

  it("applyGeocode reescribe coordenadas sin tocar el content_hash", () => {
    const [updated] = applyGeocode(
      [pharmacy({ id: "a", address: "Av. Colón 100", barrio: "Centro" })],
      {
        "av. colon 100|centro": {
          lat: -31.4,
          lon: -64.2,
          precision: "exacta",
          label: "Av. Colón 100",
          query: "x",
          at: "2026-01-01T00:00:00.000Z",
        },
      },
    );
    expect(updated).toMatchObject({ lat: -31.4, geocode_precision: "exacta", content_hash: "h" });
  });
});

describe("georef", () => {
  it("arma la dirección completa y la cortada en el primer número", () => {
    expect(georefQueries({ address: "Rep. De Siria 602 Gral Bustos", barrio: null })).toEqual([
      "República de Siria 602 General Bustos",
      "República de Siria 602",
    ]);
    expect(georefQueries({ address: "Av. Colón 2806", barrio: null })).toEqual([
      "Avenida Colón 2806",
    ]);
    expect(georefQueries({ address: null, barrio: "Centro" })).toEqual([]);
  });

  it("marca exacta sólo si Georef resolvió la altura", () => {
    const base = { ubicacion: { lat: -31.42, lon: -64.19 }, nomenclatura: "AV COLON 2806" };
    expect(toEntry("x", { ...base, altura: { valor: 2806 } }, "t")?.precision).toBe("exacta");
    expect(toEntry("x", { ...base, altura: { valor: null } }, "t")?.precision).toBe("calle");
    expect(toEntry("x", base, "t")?.precision).toBe("calle");
  });

  it("descarta lo que caiga fuera de Córdoba", () => {
    expect(
      toEntry("x", { ubicacion: { lat: -34.6, lon: -58.38 }, altura: { valor: 1 } }, "t"),
    ).toBeNull();
  });

  it("resuelve en lotes y hace una segunda vuelta con la dirección cortada", async () => {
    const lotes: string[][] = [];
    const result = await geocodeWithGeoref(
      [
        { address: "Av. Colón 2806", barrio: "Alberdi" },
        { address: "Rep. De Siria 602 Gral Bustos", barrio: null },
      ],
      {},
      {
        post: async (queries) => {
          lotes.push(queries);
          return queries.map((query) =>
            query === "República de Siria 602"
              ? { ubicacion: { lat: -31.39, lon: -64.17 }, altura: { valor: 602 } }
              : query === "Avenida Colón 2806"
                ? { ubicacion: { lat: -31.4, lon: -64.21 }, altura: { valor: 2806 } }
                : null,
          );
        },
      },
    );
    expect(result.resolved).toBe(2);
    expect(result.pending).toBe(0);
    expect(result.requests).toBe(2);
    // Primera vuelta con las dos direcciones completas, segunda sólo con la que falló.
    expect(lotes[0]).toHaveLength(2);
    expect(lotes[1]).toEqual(["República de Siria 602"]);
    expect(Object.values(result.cache).every((entry) => entry.provider === "georef")).toBe(true);
  });

  it("no vuelve a pedir lo que ya está resuelto en la cache", async () => {
    let llamadas = 0;
    const result = await geocodeWithGeoref(
      [{ address: "Av. Colón 2806", barrio: "Alberdi" }],
      {
        "av. colon 2806|alberdi": {
          lat: -31.4,
          lon: -64.21,
          precision: "exacta",
          label: null,
          query: "x",
          at: "2026-01-01T00:00:00.000Z",
        },
      },
      {
        post: async (queries) => {
          llamadas++;
          return queries.map(() => null);
        },
      },
    );
    expect(llamadas).toBe(0);
    expect(result.resolved).toBe(0);
  });
});
