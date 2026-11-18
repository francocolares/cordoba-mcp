import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  dashIndex,
  daysInMonth,
  parseEntry,
  parseTurnoSheet,
  parseWorkbook,
  splitWithoutDash,
} from "../packages/core/src/farmacias/parse.js";
import { validateWorkbook } from "../packages/core/src/farmacias/validate.js";
import { asInteger, readXlsx, unescapeXml } from "../packages/core/src/farmacias/xlsx.js";

const TURNERO = join(import.meta.dirname, "fixtures", "turnero-2026.xlsx");

describe("parseEntry", () => {
  it("corta nombre y dirección en el guion y saca el barrio", () => {
    expect(parseEntry("PONCE - Av. Gral. Paz 654 Bº Centro")).toEqual({
      name: "PONCE",
      address: "Av. Gral. Paz 654",
      barrio: "Centro",
      raw: "PONCE - Av. Gral. Paz 654 Bº Centro",
      parse_confidence: "alta",
    });
  });

  it("no corta en el guion del nombre cuando hay uno con espacios después", () => {
    const parsed = parseEntry("WAL-MART - Av. Colón 6051 Bº Don Bosco");
    expect(parsed.name).toBe("WAL-MART");
    expect(parsed.address).toBe("Av. Colón 6051");
  });

  it("saltea el guion que antecede al barrio", () => {
    const parsed = parseEntry("MADUSSI-Libertad 2033 - B° General Paz");
    expect(parsed.name).toBe("MADUSSI");
    expect(parsed.address).toBe("Libertad 2033");
    expect(parsed.barrio).toBe("General Paz");
  });

  it("no confunde 'Bonaire' con un marcador de barrio", () => {
    const parsed = parseEntry("FUTURA - Bonaire 2095 Bº Parque Futura");
    expect(parsed.address).toBe("Bonaire 2095");
    expect(parsed.barrio).toBe("Parque Futura");
  });

  it("sin guion adivina por el prefijo en mayúsculas y lo marca", () => {
    const parsed = parseEntry("MAURENZI Av. Olmos 395 esq. Salta Bº Centro");
    expect(parsed).toMatchObject({
      name: "MAURENZI",
      address: "Av. Olmos 395 esq. Salta",
      barrio: "Centro",
      parse_confidence: "baja",
    });
  });

  it("deja el número en la calle cuando es '27 de Abril'", () => {
    expect(splitWithoutDash("VIRTUAL 27 de Abril 99 Bº Centro")).toEqual({
      name: "VIRTUAL",
      rest: "27 de Abril 99 Bº Centro",
    });
  });

  it("conserva el crudo siempre, aunque el corte sea dudoso", () => {
    const raw = "ALGO RARISIMO SIN FORMA";
    expect(parseEntry(raw).raw).toBe(raw);
  });

  it("dashIndex devuelve null cuando no hay guion usable", () => {
    expect(dashIndex("SIN GUION NINGUNO")).toBeNull();
    expect(dashIndex("A-B")).toBeNull(); // demasiado al borde para ser un corte
  });
});

describe("asInteger", () => {
  it("acepta sólo celdas enteramente numéricas", () => {
    expect(asInteger("3.0")).toBe(3);
    expect(asInteger("30")).toBe(30);
    expect(asInteger(" 7 ")).toBe(7);
    // La farmacia que se llama "24" no es un número de sección.
    expect(asInteger("24 - 24 de Septiembre 2192 Bº Gral Paz")).toBeNull();
    expect(asInteger("1º TURNO")).toBeNull();
    expect(asInteger(null)).toBeNull();
  });
});

describe("unescapeXml", () => {
  it("resuelve entidades nombradas y numéricas", () => {
    expect(unescapeXml("A &amp; B &lt;c&gt; &#176; &#x41;")).toBe("A & B <c> ° A");
  });
});

describe("parseTurnoSheet", () => {
  const sheet = {
    name: "7",
    rows: [
      { row: 1, cells: { B: "7º TURNO" } },
      { row: 2, cells: { A: "Secc." } },
      { row: 3, cells: { A: "1", B: "UNA - Colón 100 Bº Centro" } },
      { row: 4, cells: { B: "OTRA - Colón 200 Bº Centro" } },
      { row: 5, cells: { B: "3" } },
      { row: 6, cells: { A: "2", B: "TERCERA - Salta 50" } },
    ],
  };

  it("arrastra la sección y descarta encabezados y números sueltos", () => {
    const rows = parseTurnoSheet(sheet, 7);
    expect(rows.map((r) => [r.name, r.section])).toEqual([
      ["UNA", 1],
      ["OTRA", 1],
      ["TERCERA", 2],
    ]);
    expect(rows.every((r) => r.turno === 7)).toBe(true);
  });
});

describe("daysInMonth", () => {
  it("conoce los febreros", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe("la planilla de 2026", () => {
  const workbook = parseWorkbook(readXlsx(readFileSync(TURNERO)));

  it("trae los 30 turnos y el año completo", () => {
    expect(workbook.year).toBe(2026);
    expect(workbook.turnos).toHaveLength(30);
    expect(Object.keys(workbook.days)).toHaveLength(365);
    expect(workbook.rows.length).toBeGreaterThan(800);
  });

  it("respeta el ciclo de 30 días desde el ancla", () => {
    expect(workbook.days["2026-01-01"]).toBe(30);
    expect(workbook.days["2026-01-02"]).toBe(1);
    expect(workbook.days["2026-12-31"]).toBe(4);
  });

  it("valida sin fails", () => {
    const result = validateWorkbook(workbook, { expectedYear: 2026 });
    expect(result.status).not.toBe("fail");
    expect(result.checks.filter((c) => c.level === "fail")).toEqual([]);
    expect(result.content_hash).toBeTruthy();
  });

  it("cada farmacia cae en un solo turno", () => {
    const byRaw = new Map<string, Set<number>>();
    for (const row of workbook.rows) {
      const turnos = byRaw.get(row.raw) ?? new Set<number>();
      turnos.add(row.turno);
      byRaw.set(row.raw, turnos);
    }
    expect([...byRaw.values()].filter((turnos) => turnos.size > 1)).toEqual([]);
  });
});
