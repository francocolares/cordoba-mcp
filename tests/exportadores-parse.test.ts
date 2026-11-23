import { describe, expect, it } from "vitest";
import { EXPORTER_PROFILES, UNRESOLVED_PROFILE } from "../packages/core/src/exportadores/config.js";
import { isNaturalPerson } from "../packages/core/src/exportadores/natural-person.js";
import {
  directoryIdsHash,
  type ExporterInput,
  readDirectorioFile,
  toExporters,
  toInstant,
} from "../packages/core/src/exportadores/normalize.js";
import { parseDirectoryListing, parseFicha } from "../packages/core/src/exportadores/parse.js";
import { validateExporters } from "../packages/core/src/exportadores/validate.js";
import { fixture } from "./helpers.js";

const LISTING = fixture("exportadores_directorio.html");
const FICHA = fixture("exportadores_ficha.html");

describe("parseDirectoryListing", () => {
  it("levanta una entrada por tarjeta del listado real", () => {
    const entries = parseDirectoryListing(LISTING);
    expect(entries).toHaveLength(4);
    expect(entries[0]).toEqual({
      externalId: "4293",
      url: "https://www.exportadoresdecordoba.com/single.php?search=4293",
      name: "384 IMPULSORES DE NEGOCIOS",
      legalName: "384 FRANQUICIAS Y PYMES S.A.S.",
      label: "EXPORTA HABITUALMENTE",
      logoUrl: "https://www.exportadoresdecordoba.com/images_db/fotos/650px/19613_logo.jpg",
      sectors: [
        { id: 84, name: "Franquicias" },
        { id: 93, name: "Servicios Profesionales" },
      ],
    });
  });

  it("no devuelve nada cuando el template cambió", () => {
    expect(parseDirectoryListing("<html><body>otra cosa</body></html>")).toEqual([]);
  });
});

describe("parseFicha", () => {
  const ficha = parseFicha(FICHA, "239");

  it("saca nombre, razón social, sitio y perfil de la ficha real", () => {
    expect(ficha.withoutContent).toBe(false);
    expect(ficha.name).toBe("DULCOR");
    expect(ficha.legalName).toBe("DULCOR S.A.");
    expect(ficha.website).toBe("https://dulcoralimentos.com.ar");
    expect(ficha.exporterProfile).toBe("Exportadora Habitual");
    expect(ficha.description).toMatch(/dulce de leche/);
  });

  it("saca rubros, países, oferta y catálogos", () => {
    expect(ficha.sectors).toHaveLength(7);
    expect(ficha.sectors[0]).toEqual({ id: 20, name: "Aceitunas" });
    expect(ficha.exportCountries.map((c) => c.name)).toContain("Brasil");
    expect(ficha.exportableOffer.length).toBeGreaterThan(5);
    expect(ficha.catalogs).toHaveLength(3);
    expect(ficha.catalogs[0]?.url).toMatch(/\.pdf$/);
  });

  it("anota los campos que la fuente enmascara en vez de inventarlos", () => {
    expect(ficha.restrictedFields).toContain("contacto");
    expect(ficha.restrictedFields).toContain("camaras");
    expect(ficha.restrictedFields).toContain("exportable_offer.posicion_arancelaria");
    expect(ficha.exportableOffer.join(" ")).not.toMatch(/Acceso con usuario/);
  });

  it("marca la ficha vacía en vez de levantar el menú como contenido", () => {
    const empty = parseFicha("<html><body><nav>INICIO DIRECTORIO</nav></body></html>", "999");
    expect(empty.withoutContent).toBe(true);
    expect(empty.name).toBeUndefined();
    expect(empty.sectors).toEqual([]);
  });
});

describe("isNaturalPerson", () => {
  it("reconoce las formas societarias", () => {
    expect(isNaturalPerson("DULCOR S.A.")).toBe(false);
    expect(isNaturalPerson("NEOCYL S.R.L.")).toBe(false);
    expect(isNaturalPerson("COOPERATIVA DE TRABAJO LIMITADA ABRAPALABRA")).toBe(false);
    expect(isNaturalPerson("TAKE ONE GROUP S A S")).toBe(false);
  });

  it("trata como persona humana lo que parece un nombre", () => {
    expect(isNaturalPerson("Juana Martínez")).toBe(true);
    expect(isNaturalPerson("JOSE LUIS PEREZ GOMEZ")).toBe(true);
  });

  it("no decide sin razón social: no saber no es serlo", () => {
    expect(isNaturalPerson(undefined)).toBeUndefined();
    expect(isNaturalPerson(null)).toBeUndefined();
    expect(isNaturalPerson("   ")).toBeUndefined();
  });
});

const input = (over: Partial<ExporterInput> & { externalId: string }): ExporterInput => ({
  url: `https://www.exportadoresdecordoba.com/single.php?search=${over.externalId}`,
  withoutContent: false,
  name: "EMPRESA",
  legalName: "EMPRESA S.A.",
  logoUrl: null,
  website: "https://empresa.test",
  socials: {},
  catalogs: [],
  description: "Hace cosas.",
  exporterProfile: "Exportadora Habitual",
  label: null,
  sectors: [{ id: 1, name: "Software" }],
  exportCountries: [{ id: 29, name: "Bolivia" }],
  exportableOffer: ["SERVICIOS"],
  restrictedFields: [],
  ...over,
});

const NOW = "2026-11-23T12:00:00.000Z";

describe("toExporters", () => {
  it("deja afuera las personas humanas y las fichas sin contenido, y las cuenta", () => {
    const result = toExporters(
      [
        input({ externalId: "1" }),
        input({ externalId: "2", legalName: "JUANA MARTINEZ" }),
        input({ externalId: "3", legalName: null }),
        input({ externalId: "4", withoutContent: true }),
      ],
      NOW,
    );

    expect(result.exporters.map((e) => e.id)).toEqual(["1"]);
    expect(result.excluded).toEqual({ naturalPersons: 2, withoutContent: 1 });
  });

  it("guarda el perfil sin resolver como null en vez de copiar el bug del template", () => {
    const { exporters } = toExporters(
      [input({ externalId: "1", exporterProfile: UNRESOLVED_PROFILE })],
      NOW,
    );
    expect(exporters[0]?.exporter_profile).toBeNull();
    expect(EXPORTER_PROFILES).not.toContain(UNRESOLVED_PROFILE);
  });

  it("el content_hash sigue al contenido, no al orden de la corrida", () => {
    const one = toExporters([input({ externalId: "1" })], NOW).exporters[0];
    const same = toExporters([input({ externalId: "1" })], "2027-01-01T00:00:00.000Z").exporters[0];
    const other = toExporters([input({ externalId: "1", website: null })], NOW).exporters[0];

    expect(one?.content_hash).toBe(same?.content_hash);
    expect(one?.content_hash).not.toBe(other?.content_hash);
  });

  it("descarta ids repetidos de la fuente y avisa", () => {
    const result = toExporters([input({ externalId: "1" }), input({ externalId: "1" })], NOW);
    expect(result.exporters).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/repetida/);
  });
});

describe("readDirectorioFile", () => {
  it("lee el consolidado del scraper y aplana la oferta exportable", () => {
    const { inputs, crawledAt, directoryTotal } = readDirectorioFile({
      extraido: "2026-11-02T14:51:32",
      total: 2,
      empresas: [
        {
          id: 1378,
          url: "https://www.exportadoresdecordoba.com/single.php?search=1378",
          sin_contenido: false,
          nombre: "+LATINA",
          razon_social: "GRAFICA LATINA SRL",
          logo: null,
          sitio_web: "https://www.maslatina.ar",
          redes: { instagram: "https://instagram.test/latina" },
          catalogos: [{ titulo: null, url: "https://archivo.test/catalogo.pdf" }],
          descripcion: "Seguridad documental.",
          perfil_exportador: "Exportadora Ocasional",
          etiqueta: "EXPORTA OCASIONALMENTE",
          rubros: [{ id: 88, nombre: "I+D, Consultores" }],
          paises_exporta: [{ id: 29, nombre: "Bolivia" }],
          oferta_exportable: [{ posicion_arancelaria: null, descripcion: "IMPRESIONES" }],
          campos_restringidos: ["camaras"],
        },
        { id: 4826, sin_contenido: true, nombre: "AGROBOR SA", razon_social: null },
      ],
    });

    expect(directoryTotal).toBe(2);
    expect(crawledAt).toBe("2026-11-02T17:51:32.000Z");
    expect(inputs[0]?.exportableOffer).toEqual(["IMPRESIONES"]);
    expect(inputs[0]?.catalogs).toEqual([
      { title: "https://archivo.test/catalogo.pdf", url: "https://archivo.test/catalogo.pdf" },
    ]);
    expect(inputs[1]?.withoutContent).toBe(true);

    const { exporters, excluded } = toExporters(inputs, NOW);
    expect(exporters.map((e) => e.name)).toEqual(["+LATINA"]);
    expect(excluded.withoutContent).toBe(1);
  });

  it("falla si el archivo no tiene la forma esperada", () => {
    expect(() => readDirectorioFile({ empresas: [{ nombre: "sin id" }] })).toThrow();
  });
});

describe("validateExporters", () => {
  const good = toExporters(
    Array.from({ length: 10 }, (_, i) => input({ externalId: String(i + 1) })),
    NOW,
  );

  const base = {
    exporters: good.exporters,
    directoryTotal: 12,
    excluded: good.excluded,
    at: NOW,
  };

  it("pasa cuando el padrón llegó completo", () => {
    const result = validateExporters(base);
    expect(result.status).toBe("ok");
    expect(result.row_count).toBe(10);
    expect(result.content_hash).toEqual(expect.any(String));
  });

  it("falla si el listado vino vacío", () => {
    const result = validateExporters({ ...base, exporters: [], directoryTotal: 0 });
    expect(result.status).toBe("fail");
    expect(result.checks.map((c) => c.code)).toContain("listado_vacio");
  });

  it("falla si el padrón se cae, para no dar de baja a todos", () => {
    const result = validateExporters({
      ...base,
      previous: {
        last_run: NOW,
        validation: null,
        counts: {
          total: 100,
          active: 100,
          inactive: 0,
          added: 0,
          updated: 0,
          removed: 0,
          readded: 0,
        },
        source: "procordoba",
        content_hash: null,
        crawled_at: null,
        directory_total: 120,
        directory_ids_hash: null,
        excluded_natural_persons: 0,
        excluded_without_content: 0,
        with_website: 0,
      },
    });
    expect(result.status).toBe("fail");
    expect(result.checks.map((c) => c.code)).toContain("caida_del_padron");
  });

  it("no compara totales en una tanda parcial", () => {
    const result = validateExporters({ ...base, directoryTotal: 2600, partial: true });
    expect(result.status).not.toBe("fail");
    expect(result.checks.map((c) => c.code)).toContain("recorrido_parcial");
  });

  it("avisa de un perfil exportador que no está en el catálogo", () => {
    const rare = toExporters(
      [input({ externalId: "9", exporterProfile: "Exportadora Lunar" })],
      NOW,
    );
    const result = validateExporters({ ...base, exporters: rare.exporters, directoryTotal: 1 });
    expect(result.status).toBe("warn");
    expect(result.checks.map((c) => c.code)).toContain("perfiles_desconocidos");
  });
});

describe("toInstant", () => {
  it("interpreta la fecha sin zona del scraper como hora de Córdoba", () => {
    expect(toInstant("2026-11-02T14:51:32")).toBe("2026-11-02T17:51:32.000Z");
  });

  it("respeta la zona cuando la fuente la declara", () => {
    expect(toInstant("2026-11-02T14:51:32Z")).toBe("2026-11-02T14:51:32.000Z");
    expect(toInstant(null)).toBeNull();
    expect(toInstant("cuando se pudo")).toBeNull();
  });
});

describe("directoryIdsHash", () => {
  it("no depende del orden del listado", () => {
    expect(directoryIdsHash(["3", "1", "2"])).toBe(directoryIdsHash(["1", "2", "3"]));
    expect(directoryIdsHash(["1", "2"])).not.toBe(directoryIdsHash(["1", "2", "3"]));
  });
});
