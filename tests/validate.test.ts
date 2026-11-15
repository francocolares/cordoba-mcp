import { describe, expect, it } from "vitest";
import { SHEET_ID } from "../packages/core/src/config.js";
import { evaluate, extractBundleUrl, extractSheetIds } from "../packages/core/src/validate.js";
import { fixture } from "./helpers.js";

const html = fixture("agenda_page.html");
const gviz = fixture("gviz_response.txt");
const bundle = fixture("main.js");

const codes = (result: ReturnType<typeof evaluate>) => result.checks.map((c) => c.code);

describe("extracción", () => {
  it("encuentra el bundle en el HTML real", () => {
    expect(extractBundleUrl(html)).toContain("agenda-cultura/main.js");
    expect(extractBundleUrl("<html><script src='/otro.js'></script></html>")).toBeNull();
  });

  it("encuentra el sheet ID en el atributo sheetid de <app-root>", () => {
    expect(extractSheetIds(html)).toContain(SHEET_ID);
  });

  it("también lo encuentra en una URL de spreadsheets", () => {
    expect(
      extractSheetIds(`fetch("https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq")`),
    ).toEqual([SHEET_ID]);
  });
});

describe("evaluate", () => {
  it("los fixtures originales dan ok", () => {
    const result = evaluate({ html, bundleJs: bundle, gviz });
    expect(result.status).toBe("ok");
    expect(codes(result)).toEqual(
      expect.arrayContaining(["page_ok", "bundle_present", "sheet_id_ok", "schema_ok"]),
    );
    expect(result.row_count).toBeGreaterThan(0);
    expect(result.schema_hash).toBeTruthy();
  });

  it("otro sheet ID => FAIL sheet_id_changed", () => {
    const otro = "9ZZZ_OOHkx2-xwg9UfzPMiEMv4pXEdJMZcXxbhk665Nw";
    const result = evaluate({ html: html.replaceAll(SHEET_ID, otro), gviz });
    expect(result.status).toBe("fail");
    expect(codes(result)).toContain("sheet_id_changed");
    expect(result.checks.find((c) => c.code === "sheet_id_changed")?.detail).toEqual({
      found: [otro],
    });
  });

  it("columna renombrada => FAIL schema_changed", () => {
    const result = evaluate({ html, gviz: gviz.replace('"label":"Lugar"', '"label":"Ubicacion"') });
    expect(result.status).toBe("fail");
    const check = result.checks.find((c) => c.code === "schema_changed");
    expect(check?.detail).toMatchObject({ missing: ["Lugar"], extra: ["Ubicacion"] });
  });

  it("sin el script en la página => FAIL bundle_missing", () => {
    const result = evaluate({
      html: html.replaceAll("agenda-cultura/main.js", "otra-cosa.js"),
      gviz,
    });
    expect(result.status).toBe("fail");
    expect(codes(result)).toContain("bundle_missing");
  });

  it("sin sheet ID en ningún lado => WARN, no FAIL", () => {
    const result = evaluate({ html: html.replaceAll(SHEET_ID, "corto"), gviz });
    expect(result.status).toBe("warn");
    expect(codes(result)).toContain("sheet_id_not_found");
  });

  it("página bloqueada => WARN page_blocked y sigue validando el esquema", () => {
    const result = evaluate({ html: null, pageError: "HTTP 403", gviz });
    expect(result.status).toBe("warn");
    expect(codes(result)).toEqual(["page_blocked", "schema_ok"]);
  });

  it("planilla vacía => WARN empty_sheet", () => {
    const empty = gviz.replace(/"rows":\[.*\]/s, '"rows":[]');
    const result = evaluate({ html, gviz: empty });
    expect(codes(result)).toContain("empty_sheet");
    expect(result.row_count).toBe(0);
  });

  it("bundle distinto con el mismo ID => INFO bundle_changed", () => {
    const result = evaluate({
      html,
      bundleJs: `${bundle}// cambió`,
      gviz,
      previousBundleHash: "hash-viejo",
    });
    expect(result.status).toBe("ok");
    expect(codes(result)).toContain("bundle_changed");
  });

  it("gviz caído => FAIL", () => {
    const result = evaluate({ html, gviz: null, gvizError: "timeout" });
    expect(result.status).toBe("fail");
    expect(codes(result)).toContain("gviz_unreachable");
  });
});
