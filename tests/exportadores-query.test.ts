import { describe, expect, it } from "vitest";
import { exportadores } from "../packages/core/src/collections/exportadores.js";
import type { Exporter } from "../packages/core/src/exportadores/models.js";
import { envelope, type Snapshot, TOOLS } from "../packages/core/src/tools.js";

const exporter = (over: Partial<Exporter> & { id: string; name: string }): Exporter => ({
  source: "procordoba",
  url: `https://www.exportadoresdecordoba.com/single.php?search=${over.id}`,
  legal_name: `${over.name} S.A.`,
  logo_url: null,
  website: "https://empresa.test",
  socials: {},
  catalogs: [],
  description: null,
  exporter_profile: "Exportadora Habitual",
  label: null,
  sectors: [{ id: 1, name: "Software" }],
  export_countries: [{ id: 29, name: "Bolivia" }],
  exportable_offer: [],
  restricted_fields: ["contacto"],
  active: true,
  first_seen: "2026-11-01T00:00:00.000Z",
  last_seen: "2026-11-23T00:00:00.000Z",
  content_hash: "h",
  ...over,
});

const EXPORTERS: Exporter[] = [
  exporter({
    id: "1",
    name: "DULCOR",
    legal_name: "DULCOR S.A.",
    description: "Dulce de leche y mermeladas.",
    sectors: [
      { id: 16, name: "Dulces y Confituras" },
      { id: 11, name: "Lácteos" },
    ],
    export_countries: [
      { id: 76, name: "Brasil" },
      { id: 172, name: "Paraguay" },
    ],
    exportable_offer: ["DULCE DE LECHE", "MERMELADAS"],
  }),
  exporter({
    id: "2",
    name: "NEOCYL",
    sectors: [{ id: 64, name: "Otras manufacturas Industriales" }],
    export_countries: [{ id: 76, name: "Brasil" }],
    exporter_profile: "Exportadora Ocasional",
    website: null,
  }),
  exporter({
    id: "3",
    name: "PROTEA",
    sectors: [],
    export_countries: [],
    exporter_profile: null,
  }),
  exporter({ id: "4", name: "SE FUE DEL DIRECTORIO", active: false }),
];

const store = {
  exporters: EXPORTERS,
  status: null,
  data_as_of: "2026-11-02T14:51:32.000Z",
};

const snapshot: Snapshot = { exportadores: store };

const search = (args: Record<string, unknown>) => {
  const tool = TOOLS.find((t) => t.name === "search");
  if (!tool) throw new Error("no existe el tool search");
  return tool.handler(snapshot, { collection: "exportadores", ...args });
};

const items = (result: { data: Record<string, unknown> }) =>
  result.data["items"] as Record<string, unknown>[];

const errorOf = (result: { data: Record<string, unknown> }) =>
  result.data["error"] as { code: string; valid_values?: unknown[] };

describe("el descriptor de exportadores", () => {
  it("no filtra por fecha ni por cercanía: es un padrón", () => {
    expect(exportadores.descriptor.supports.date).toBe("none");
    expect(exportadores.descriptor.supports.near).toBe(false);
    expect(errorOf(search({ date: { from: "hoy" } })).code).toBe("unsupported");
    expect(errorOf(search({ near: { lat: -31.4, lon: -64.2 } })).code).toBe("unsupported");
  });

  it("declara en cada respuesta el recorte de datos personales y la atribución", () => {
    const notes = envelope(snapshot, {}, "exportadores")["notes"] as string[];
    expect(notes.join(" ")).toMatch(/dato personal/);
    expect(notes.join(" ")).toMatch(/ProCórdoba/);
  });

  it("declara los términos de la fuente sin afirmar más de lo que dicen", () => {
    const sources = envelope(snapshot, {}, "exportadores")["sources"] as { license: string }[];
    expect(sources[0]?.license).toMatch(/ai-train=no/);
  });
});

describe("search sobre exportadores", () => {
  it("por defecto deja afuera las que ya no están en el directorio", () => {
    expect(items(search({})).map((i) => i["name"])).toEqual(["DULCOR", "NEOCYL", "PROTEA"]);
    expect(items(search({ filters: { include_inactive: true } }))).toHaveLength(4);
  });

  it("busca en nombre, razón social, descripción, oferta y rubros", () => {
    expect(items(search({ query: "dulce de leche" }))[0]?.["name"]).toBe("DULCOR");
    expect(items(search({ query: "lacteos" }))[0]?.["name"]).toBe("DULCOR");
    expect(items(search({ query: "neocyl" }))[0]?.["name"]).toBe("NEOCYL");
  });

  it("filtra por rubro y por país de destino", () => {
    expect(items(search({ filters: { rubro: "dulces" } }))).toHaveLength(1);
    expect(items(search({ filters: { pais_exporta: "brasil" } })).map((i) => i["name"])).toEqual([
      "DULCOR",
      "NEOCYL",
    ]);
    expect(items(search({ filters: { pais_exporta: "Noruega" } }))).toHaveLength(0);
  });

  it("filtra por perfil exportador y devuelve los válidos si no existe", () => {
    expect(items(search({ filters: { perfil_exportador: "Exportadora Ocasional" } }))).toHaveLength(
      1,
    );
    const bad = errorOf(search({ filters: { perfil_exportador: "Exportadora Lunar" } }));
    expect(bad.code).toBe("invalid_filter_value");
    expect(bad.valid_values).toContain("Exportadora Habitual");
  });

  it("filtra por tener o no sitio web", () => {
    expect(items(search({ filters: { con_sitio: true } })).map((i) => i["name"])).toEqual([
      "DULCOR",
      "PROTEA",
    ]);
    expect(items(search({ filters: { con_sitio: false } })).map((i) => i["name"])).toEqual([
      "NEOCYL",
    ]);
  });

  it("rechaza un filtro que la colección no declara", () => {
    const bad = errorOf(search({ filters: { cuit: "30-1234" } }));
    expect(bad.code).toBe("unknown_filter");
    expect(bad.valid_values).toContain("rubro");
  });

  it("agrupa por rubro, país y perfil, contando una empresa en cada uno de sus rubros", () => {
    const byRubro = search({ group_by: "rubro" }).data["groups"] as {
      key: string | null;
      count: number;
    }[];
    expect(byRubro).toEqual(
      expect.arrayContaining([
        { key: "Dulces y Confituras", count: 1 },
        { key: "Lácteos", count: 1 },
        { key: null, count: 1 },
      ]),
    );

    const byPerfil = search({ group_by: "perfil_exportador" }).data["groups"] as {
      key: string | null;
      count: number;
    }[];
    expect(byPerfil).toEqual(
      expect.arrayContaining([
        { key: "Exportadora Habitual", count: 1 },
        { key: null, count: 1 },
      ]),
    );
  });

  it("el resumen trae lo que decide una búsqueda y el full, la ficha entera", () => {
    const summary = items(search({ query: "dulcor" }))[0]!;
    expect(Object.keys(summary).sort()).toEqual(
      [
        "description",
        "export_countries",
        "exporter_profile",
        "id",
        "legal_name",
        "name",
        "sectors",
        "website",
      ].sort(),
    );
    expect(summary["id"]).toBe("exportadores:procordoba:1");
    expect(summary["sectors"]).toEqual(["Dulces y Confituras", "Lácteos"]);

    const full = items(search({ query: "dulcor", fields: "full" }))[0]!;
    expect(full["restricted_fields"]).toEqual(["contacto"]);
    expect(full["url"]).toMatch(/single\.php\?search=1$/);
  });
});

describe("get y taxonomías", () => {
  it("trae la ficha completa por id con prefijo", () => {
    const tool = TOOLS.find((t) => t.name === "get");
    if (!tool) throw new Error("no existe el tool get");
    const result = tool.handler(snapshot, {
      ids: ["exportadores:procordoba:1", "exportadores:procordoba:nope"],
    });
    const found = result.data["records"] as Record<string, unknown>[];
    expect(found).toHaveLength(1);
    expect(found[0]?.["name"]).toBe("DULCOR");
    expect(result.data["missing"]).toEqual(["exportadores:procordoba:nope"]);
  });

  it("publica los rubros y países con conteo, que es el catálogo de los filtros", () => {
    const taxonomies = exportadores.taxonomies?.(store) as Record<
      string,
      { key: string | null; count: number }[]
    >;
    expect(taxonomies["rubro"]).toEqual(
      expect.arrayContaining([{ key: "Dulces y Confituras", count: 1 }]),
    );
    expect(taxonomies["pais_exporta"]).toEqual(
      expect.arrayContaining([{ key: "Brasil", count: 2 }]),
    );
  });
});

describe("dump y hydrate", () => {
  it("vuelven al mismo store, que es lo que lee el Worker desde R2", () => {
    const dumped = exportadores.dump(store);
    const records = `${(dumped.jsonl as Exporter[]).map((e) => JSON.stringify(e)).join("\n")}\n`;
    const hydrated = exportadores.hydrate({
      records,
      extras: { "status.json": null },
    }) as typeof store;

    expect(hydrated.exporters).toEqual(EXPORTERS);
    expect(hydrated.data_as_of).toBe("2026-11-23T00:00:00.000Z");
  });

  it("sin registros no hay colección", () => {
    expect(exportadores.hydrate({ records: null, extras: {} })).toBeNull();
  });
});
