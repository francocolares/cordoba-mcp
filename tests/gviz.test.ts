import { describe, expect, it } from "vitest";
import { EXPECTED_COLUMNS } from "../packages/core/src/config.js";
import { cellText, columns, GvizError, rows, unwrap } from "../packages/core/src/gviz.js";
import { fixture } from "./helpers.js";

const raw = fixture("gviz_response.txt");

describe("unwrap", () => {
  it("desenvuelve la respuesta real", () => {
    const payload = unwrap(raw);
    expect(payload.status).toBe("ok");
    expect(columns(payload)).toEqual([...EXPECTED_COLUMNS]);
  });

  it("falla si el texto está corrupto", () => {
    expect(() => unwrap("/*O_o*/ google.visualization.Query.setResponse(")).toThrow(GvizError);
    expect(() => unwrap("/*O_o*/ setResponse({no json)")).toThrow(GvizError);
  });

  it('falla si status != "ok"', () => {
    const text = `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify({
      status: "error",
      errors: [{ message: "invalid_query", detailed_message: "no existe" }],
    })});`;
    expect(() => unwrap(text)).toThrow(/status="error".*no existe/);
  });
});

describe("rows", () => {
  const parsed = rows(unwrap(raw));

  it("devuelve filas con las 15 columnas mapeadas por label", () => {
    expect(parsed.length).toBeGreaterThan(0);
    for (const row of parsed) {
      expect(Object.keys(row.values)).toEqual([...EXPECTED_COLUMNS]);
    }
  });

  it("conserva el índice de fila y el valor crudo de la fecha", () => {
    expect(parsed[0]?.index).toBe(0);
    expect(String(parsed[0]?.raw["fecha_ini"])).toMatch(/^Date\(\d{4},\d{1,2},\d{1,2}\)$/);
  });
});

describe("cellText", () => {
  it("prioriza f sobre v y mapea vacíos a null", () => {
    expect(cellText({ v: "Date(2026,10,29)", f: "29/11/2026" })).toBe("29/11/2026");
    expect(cellText({ v: 1 })).toBe("1");
    expect(cellText(null)).toBeNull();
    expect(cellText({ v: "" })).toBeNull();
  });
});
