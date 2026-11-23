import { describe, expect, it } from "vitest";
import type { Pharmacy, TurnoCalendar } from "../packages/core/src/farmacias/models.js";
import type { Event } from "../packages/core/src/models.js";
import { envelope, type Snapshot, TOOLS } from "../packages/core/src/tools.js";

/* ---------------------------------------------------------- fixtures ----- */

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

const event = (over: Partial<Event> & { id: string; start: string }): Event => ({
  source: "turismo_muni",
  source_row: 1,
  title: "Concierto",
  description: null,
  category_raw: "Música",
  category: "musica",
  end: null,
  all_day: false,
  venue: "Teatro",
  organizer: null,
  ticket_url: null,
  price_type: "pago",
  price_raw: null,
  is_permanent: false,
  permanent_schedule: null,
  image_url: null,
  status_raw: null,
  active: true,
  first_seen: "2026-01-01T00:00:00.000Z",
  last_seen: "2026-01-01T00:00:00.000Z",
  content_hash: "h",
  ...over,
});

const snapshot: Snapshot = {
  eventos: {
    events: [
      event({ id: "e1", start: "2026-01-03T21:00:00-03:00", title: "Tango en el Cabildo" }),
      event({
        id: "e2",
        start: "2026-01-04T18:00:00-03:00",
        title: "Feria de libros",
        category: "feria",
        price_type: "gratis",
      }),
      event({ id: "e3", start: "2026-01-10T20:00:00-03:00", title: "Orquesta sinfónica" }),
    ],
    status: null,
    data_as_of: "2026-01-01T00:00:00.000Z",
  },
  farmacias_turno: {
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

const sinFarmacias: Snapshot = { eventos: snapshot["eventos"], farmacias_turno: null };

const tool = (name: string) => {
  const found = TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`no existe el tool ${name}`);
  return found;
};

const call = (name: string, args: Record<string, unknown> = {}, snap: Snapshot = snapshot) =>
  tool(name).handler(snap, args);

const errorOf = (result: { data: Record<string, unknown> }) =>
  result.data["error"] as { code: string; valid_values?: unknown[] };

/* ------------------------------------------------------------- tests ----- */

describe("la superficie de tools", () => {
  it("son cuatro y están congeladas", () => {
    expect(TOOLS.map((t) => t.name)).toEqual([
      "list_collections",
      "search",
      "get",
      "source_status",
    ]);
  });

  it("ninguna descripción nombra una fuente concreta: el catálogo se descubre", () => {
    for (const t of TOOLS) {
      expect(t.description).not.toMatch(/Municipalidad|Colegio de Farmac/);
    }
  });
});

describe("list_collections", () => {
  it("publica filtros y soporte de cada colección sin pedirlo", () => {
    const { data } = call("list_collections");
    const list = data["collections"] as { id: string; filters: unknown[]; supports: unknown }[];
    expect(list.map((c) => c.id)).toEqual(["eventos", "farmacias_turno", "exportadores"]);
    expect(list[0]!.filters.length).toBeGreaterThan(0);
    expect(list[0]!.supports).toMatchObject({ near: false, date: "range" });
  });

  it("suma taxonomías y ejemplos sólo si los piden", () => {
    const plano = call("list_collections", { collection: "eventos" });
    expect(
      (plano.data["collections"] as Record<string, unknown>[])[0]!["taxonomies"],
    ).toBeUndefined();

    const rico = call("list_collections", {
      collection: "eventos",
      include: ["taxonomies", "examples"],
    });
    const first = (rico.data["collections"] as Record<string, unknown>[])[0]!;
    expect(first["taxonomies"]).toMatchObject({ category: expect.any(Array) });
    expect(first["examples"]).toBeDefined();
  });

  it("una colección inexistente devuelve los ids válidos", () => {
    const result = call("list_collections", { collection: "farmacias" });
    expect(result.isError).toBe(true);
    expect(errorOf(result).code).toBe("unknown_collection");
    expect(errorOf(result).valid_values).toEqual(["eventos", "farmacias_turno", "exportadores"]);
  });
});

describe("search sobre eventos", () => {
  it("filtra por texto y devuelve ids con prefijo de colección y fuente", () => {
    const { data } = call("search", {
      collection: "eventos",
      query: "tango",
      date: { include_past: true },
    });
    const items = data["items"] as { id: string }[];
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe("eventos:turismo_muni:e1");
  });

  it("agrupa por una clave declarada", () => {
    const { data } = call("search", {
      collection: "eventos",
      group_by: "category",
      date: { include_past: true },
    });
    expect(data["groups"]).toEqual([
      { key: "musica", count: 2 },
      { key: "feria", count: 1 },
    ]);
  });

  it("pagina con cursor opaco y declara el total", () => {
    const first = call("search", {
      collection: "eventos",
      limit: 2,
      date: { include_past: true },
    });
    expect(first.data).toMatchObject({ count: 2, total: 3, truncated: true });

    const second = call("search", {
      collection: "eventos",
      limit: 2,
      cursor: first.data["next_cursor"],
      date: { include_past: true },
    });
    expect(second.data).toMatchObject({ count: 1, truncated: false });
    expect(second.data["next_cursor"]).toBeUndefined();
  });

  it("rechaza near porque la colección no tiene coordenadas", () => {
    const result = call("search", { collection: "eventos", near: { lat: -31.4, lon: -64.2 } });
    expect(result.isError).toBe(true);
    expect(errorOf(result).code).toBe("unsupported");
  });

  it("un filtro desconocido devuelve los válidos", () => {
    const result = call("search", { collection: "eventos", filters: { barrio: "Centro" } });
    expect(errorOf(result).code).toBe("unknown_filter");
    expect(errorOf(result).valid_values).toContain("free_only");
  });

  it("un valor fuera del enum devuelve el enum", () => {
    const result = call("search", { collection: "eventos", filters: { category: "jazz" } });
    expect(errorOf(result).code).toBe("invalid_filter_value");
    expect(errorOf(result).valid_values).toContain("musica");
  });

  it("un cursor inventado falla con su propio código", () => {
    const result = call("search", { collection: "eventos", cursor: "no-es-un-cursor" });
    expect(errorOf(result).code).toBe("invalid_cursor");
  });
});

describe("search sobre farmacias_turno", () => {
  it("resuelve el turno del día y lo declara en el resultado", () => {
    const { data } = call("search", {
      collection: "farmacias_turno",
      date: { from: "2026-01-03" },
    });
    expect(data).toMatchObject({ turno: 2, service_date: "2026-01-03", count: 2, total: 2 });
    expect(data["window"]).toMatchObject({
      from: "2026-01-03T08:30:00-03:00",
      to: "2026-01-04T08:30:00-03:00",
    });
  });

  it("filtra por barrio y por sección", () => {
    expect(
      call("search", {
        collection: "farmacias_turno",
        date: { from: "2026-01-03" },
        filters: { barrio: "alberdi" },
      }).data["count"],
    ).toBe(1);
    expect(
      call("search", {
        collection: "farmacias_turno",
        date: { from: "2026-01-03" },
        filters: { seccion: 4 },
      }).data["count"],
    ).toBe(1);
  });

  it("ordena por distancia, recorta por radio y reporta las no geocodificadas", () => {
    const { data } = call("search", {
      collection: "farmacias_turno",
      date: { from: "2026-01-03" },
      near: { lat: -31.41, lon: -64.211 },
    });
    const items = data["items"] as { id: string; distance_km: number }[];
    expect(items.map((p) => p.id)).toEqual([
      "farmacias_turno:colegio_farmaceuticos:b",
      "farmacias_turno:colegio_farmaceuticos:a",
    ]);
    expect(items[0]!.distance_km).toBeLessThan(items[1]!.distance_km);
    expect(data["without_coords"]).toBe(0);

    const conRadio = call("search", {
      collection: "farmacias_turno",
      date: { from: "2026-01-03" },
      near: { lat: -31.41, lon: -64.211, radius_km: 1 },
    });
    expect(conRadio.data["count"]).toBe(1);
  });

  it("agrupa por sección sin listar todo", () => {
    const { data } = call("search", {
      collection: "farmacias_turno",
      date: { from: "2026-01-03" },
      group_by: "seccion",
      limit: 1,
    });
    expect(data["groups"]).toEqual([
      { key: 1, count: 1 },
      { key: 4, count: 1 },
    ]);
  });

  it("con on_duty:false busca en todo el padrón y dice cuándo le toca", () => {
    const { data } = call("search", {
      collection: "farmacias_turno",
      query: "alberdi",
      filters: { on_duty: false },
    });
    const items = data["items"] as { turno: number; next_duty_dates: unknown[] }[];
    expect(items).toHaveLength(1);
    expect(items[0]!.turno).toBe(2);
    expect(items[0]!.next_duty_dates.length).toBeGreaterThan(0);
    expect(data["turno"]).toBeUndefined();
  });

  it("proyecta el turno con el ciclo cuando no hay turnero de ese año", () => {
    const result = call("search", {
      collection: "farmacias_turno",
      date: { from: "2030-05-05" },
    });
    expect(result.isError).toBeUndefined();
    expect(result.data["derived_from_cycle"]).toBe(true);
  });

  it("una fecha que no se puede interpretar falla con los tokens válidos", () => {
    const result = call("search", {
      collection: "farmacias_turno",
      date: { from: "el jueves que viene" },
    });
    expect(errorOf(result).code).toBe("invalid_date");
    expect(errorOf(result).valid_values).toContain("ahora");
  });

  it("un rango de fechas no aplica: la guardia rota día por día", () => {
    const result = call("search", {
      collection: "farmacias_turno",
      date: { from: "2026-01-03", to: "2026-01-05" },
    });
    expect(errorOf(result).code).toBe("unsupported");
  });
});

describe("get", () => {
  it("trae el registro completo por id con prefijo", () => {
    const { data } = call("get", { ids: ["eventos:turismo_muni:e1"] });
    const records = data["records"] as { id: string; link: string }[];
    expect(data["count"]).toBe(1);
    expect(records[0]!.id).toBe("eventos:turismo_muni:e1");
    expect(records[0]!.link).toContain("turismo.cordoba.gob.ar");
  });

  it("acepta un id pelado mientras no sea ambiguo", () => {
    const { data } = call("get", { ids: ["e1"] });
    expect(data["count"]).toBe(1);
  });

  it("mezcla colecciones en una sola llamada y lista lo que falta", () => {
    const { data } = call("get", {
      ids: [
        "eventos:turismo_muni:e1",
        "farmacias_turno:colegio_farmaceuticos:a",
        "eventos:turismo_muni:nope",
      ],
    });
    expect(data["count"]).toBe(2);
    expect(data["missing"]).toEqual(["eventos:turismo_muni:nope"]);
  });

  it("suma los datos derivados que la colección declara", () => {
    const { data } = call("get", {
      ids: ["farmacias_turno:colegio_farmaceuticos:a"],
      expand: ["next_duty_dates"],
    });
    const records = data["records"] as { next_duty_dates: unknown[] }[];
    expect(records[0]!.next_duty_dates.length).toBeGreaterThan(0);
  });

  it("un expand que no existe devuelve los válidos", () => {
    const result = call("get", {
      ids: ["farmacias_turno:colegio_farmaceuticos:a"],
      expand: ["clima"],
    });
    expect(errorOf(result).code).toBe("unsupported");
    expect(errorOf(result).valid_values).toEqual(["next_duty_dates"]);
  });

  it("ids inexistentes son not_found, no una respuesta vacía", () => {
    const result = call("get", { ids: ["eventos:turismo_muni:nope"] });
    expect(result.isError).toBe(true);
    expect(errorOf(result).code).toBe("not_found");
  });

  it("un id mal formado se distingue de uno inexistente", () => {
    const result = call("get", { ids: ["eventos:nope"] });
    expect(errorOf(result).code).toBe("invalid_id");
  });
});

describe("fuente no disponible", () => {
  it("search y get lo dicen con el mismo código, sin colgarse", () => {
    for (const args of [
      { collection: "farmacias_turno" },
      { collection: "farmacias_turno", near: { lat: -31.4, lon: -64.2 } },
    ]) {
      const result = call("search", args, sinFarmacias);
      expect(errorOf(result).code).toBe("source_unavailable");
    }
    const result = call("get", { ids: ["farmacias_turno:colegio_farmaceuticos:a"] }, sinFarmacias);
    expect(result.isError).toBe(true);
  });

  it("list_collections la muestra igual, marcada como no disponible", () => {
    const { data } = call("list_collections", {}, sinFarmacias);
    const list = data["collections"] as { id: string; available: boolean }[];
    expect(list.find((c) => c.id === "farmacias_turno")!.available).toBe(false);
  });
});

describe("el envelope", () => {
  it("tiene siempre la misma forma y acredita a las fuentes de la colección", () => {
    const farmacias = envelope(snapshot, {}, "farmacias_turno");
    expect(farmacias["collection"]).toBe("farmacias_turno");
    expect(farmacias["timezone"]).toBe("America/Argentina/Cordoba");
    expect(farmacias["catalog_version"]).toEqual(expect.any(String));
    expect(String(farmacias["service"])).toContain("unificada y estandarizada");
    const sources = farmacias["sources"] as { name: string }[];
    expect(sources).toHaveLength(1);
    expect(sources[0]!.name).toContain("Colegio de Farmacéuticos");
    expect(farmacias["data_as_of"]).toBe("2026-01-02T00:00:00.000Z");
  });

  it("el disclaimer de la guardia viaja como nota de la colección", () => {
    const notes = envelope(snapshot, {}, "farmacias_turno")["notes"] as string[];
    expect(notes.join(" ")).toContain("no figura en la planilla");
    expect(envelope(snapshot, {}, "eventos")["notes"]).toBeUndefined();
  });

  it("sin colección acredita a todas las fuentes cargadas", () => {
    const sources = envelope(snapshot, {})["sources"] as unknown[];
    expect(sources).toHaveLength(2);
  });
});

describe("source_status", () => {
  it("reporta cada colección con su fuente y sus conteos", () => {
    const { data } = call("source_status");
    const list = data["collections"] as Record<string, unknown>[];
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({ id: "eventos", available: true, records: 3 });
    expect(list[1]).toMatchObject({ id: "farmacias_turno", geocoded: 2, years: [2026] });
    expect(list[2]).toMatchObject({ id: "exportadores", available: false });
  });

  it("marca la colección que no está cargada", () => {
    const { data } = call("source_status", { collection: "farmacias_turno" }, sinFarmacias);
    const list = data["collections"] as Record<string, unknown>[];
    expect(list[0]).toMatchObject({ available: false });
    expect(list[0]!["error"]).toBeDefined();
  });
});
