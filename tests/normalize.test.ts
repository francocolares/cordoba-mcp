import { describe, expect, it } from "vitest";
import { classify } from "../packages/core/src/categories.js";
import {
  parseDate,
  parseTime,
  resolveDateInput,
  weekendRange,
} from "../packages/core/src/datetime.js";
import type { GvizRow } from "../packages/core/src/gviz.js";
import { eventId, normalizeRow, priceType } from "../packages/core/src/normalize.js";

const NOW = "2026-11-12T10:00:00.000Z";

function row(values: Record<string, string | null>, index = 0): GvizRow {
  const base: Record<string, string | null> = {
    fecha_ini: null,
    Hora: null,
    Fecha_fin: null,
    Hora_fin: null,
    Nombre: null,
    "Tipo de Evento": null,
    Descripción: null,
    Lugar: null,
    Organizador: null,
    Inscripción: null,
    Precio: null,
    Estado: "1",
    Permanente: null,
    "Horarios Permanente": null,
    Imagen: null,
  };
  return { index, values: { ...base, ...values }, raw: {} };
}

describe("parseDate", () => {
  it.each([
    ["17/09/2026", "2026-9-17"],
    ["2/1/2027", "2027-1-2"],
    ["Date(2026,10,29)", "2026-11-29"], // mes base 0
    ["2026-11-29", "2026-11-29"],
  ])("parsea %s", (input, expected) => {
    const d = parseDate(input)!;
    expect(`${d.year}-${d.month}-${d.day}`).toBe(expected);
  });

  it.each([null, "", "no es fecha"])("devuelve null para %s", (input) => {
    expect(parseDate(input)).toBeNull();
  });
});

describe("parseTime", () => {
  it.each([
    ["20:00", 20, 0],
    ["9:30", 9, 30],
    ["Date(1899,11,30,20,0,0)", 20, 0],
  ])("parsea %s", (input, hour, minute) => {
    expect(parseTime(input)).toEqual({ hour, minute });
  });

  it("devuelve null si está vacío o fuera de rango", () => {
    expect(parseTime(null)).toBeNull();
    expect(parseTime("")).toBeNull();
    expect(parseTime("99:99")).toBeNull();
  });
});

describe("priceType", () => {
  it.each([
    ["0", null, "gratis"],
    ["Gratis con inscripción previa", null, "gratis"],
    ["Entrada libre y gratuita", null, "gratis"],
    ["Con costo", null, "pago"],
    ["Comprá tu entrada en “Inscribite”", "https://alpogo.com/x", "pago"],
    [null, "https://alpogo.com/x", "pago"],
    [null, null, "desconocido"],
  ])("%s + %s => %s", (price, url, expected) => {
    expect(priceType(price, url)).toBe(expected);
  });
});

describe("classify", () => {
  it.each([
    ["Música", "musica"],
    ["Música electrónica", "musica"],
    ["Música / Bachata", "musica"],
    ["Concierto sinfónico", "musica"],
    ["Teatro", "teatro"],
    ["Teatro ", "teatro"],
    ["Teatro inmersivo", "teatro"],
    ["Teatro musical", "teatro"],
    ["Teatro / Thriller psicológico", "teatro"],
    ["Teatro musical infantil", "infantil"],
    ["Humor", "humor"],
    ["Humor / Stand-up", "humor"],
    ["Humor / Stand up", "humor"],
    ["Humor / Stand-up comedy", "humor"],
    ["Comedia en vivo", "humor"],
    ["Danza", "danza"],
    ["Danza contemporánea", "danza"],
    ["Ballet clásico", "danza"],
    ["Visita guiada", "visita_guiada"],
    ["Cultura / Museos", "museos_cultura"],
    ["Feria del libro / Feria cultural y literaria.", "feria"],
    ["Conferencia", "conferencia"],
    ["Fiesta temática", "fiesta"],
    ["Streaming en vivo", "streaming"],
    ["Cultura / Gastronomía / Familiar", "gastronomia"],
  ])("%s => %s", (raw, expected) => {
    const result = classify(raw);
    expect(result.category).toBe(expected);
    expect(result.matched).toBe(true);
  });

  it("manda a otro lo que no matchea y lo marca", () => {
    expect(classify("Criptomonedas")).toEqual({ category: "otro", matched: false });
    expect(classify(null)).toEqual({ category: "otro", matched: false });
  });
});

describe("normalizeRow", () => {
  it("normaliza una fila completa", () => {
    const { event, warnings } = normalizeRow(
      row({
        fecha_ini: "17/09/2026",
        Hora: "20:00",
        Fecha_fin: "15/11/2026",
        Hora_fin: "22:30",
        Nombre: "  Pabellón Tornú  ",
        "Tipo de Evento": "Teatro inmersivo",
        Lugar: "Ex Cárcel de Encausados",
        Inscripción: "https://ventas.autoentrada.com/events/x",
        Precio: "Con costo",
      }),
      NOW,
    );
    expect(warnings).toEqual([]);
    expect(event).toMatchObject({
      title: "Pabellón Tornú",
      category: "teatro",
      start: "2026-09-17T20:00:00-03:00",
      end: "2026-11-15T22:30:00-03:00",
      all_day: false,
      price_type: "pago",
      active: true,
      is_permanent: false,
    });
    expect(event?.content_hash).toHaveLength(40);
  });

  it("marca all_day y 00:00 si no hay hora", () => {
    const { event } = normalizeRow(row({ fecha_ini: "Date(2026,10,29)", Nombre: "Feria" }), NOW);
    expect(event?.start).toBe("2026-11-29T00:00:00-03:00");
    expect(event?.all_day).toBe(true);
  });

  it("suma un día si el show cruza la medianoche", () => {
    const { event } = normalizeRow(
      row({
        fecha_ini: "29/11/2026",
        Hora: "23:00",
        Fecha_fin: "29/11/2026",
        Hora_fin: "02:00",
        Nombre: "After",
      }),
      NOW,
    );
    expect(event?.start).toBe("2026-11-29T23:00:00-03:00");
    expect(event?.end).toBe("2026-11-30T02:00:00-03:00");
  });

  it("descarta filas sin nombre o sin fecha, con warning", () => {
    expect(normalizeRow(row({ fecha_ini: "29/11/2026" }), NOW).event).toBeNull();
    const bad = normalizeRow(row({ Nombre: "Sin fecha", fecha_ini: "???" }), NOW);
    expect(bad.event).toBeNull();
    expect(bad.warnings[0]).toMatch(/fecha_ini ilegible/);
  });

  it("el id es estable e independiente de la fila", () => {
    const a = normalizeRow(
      row(
        { fecha_ini: "29/11/2026", Hora: "20:00", Nombre: "Polenta Pop", Lugar: "Plaza  España" },
        55,
      ),
      NOW,
    );
    const b = normalizeRow(
      row(
        { fecha_ini: "29/11/2026", Hora: "21:00", Nombre: "POLENTA  pop", Lugar: "plaza españa" },
        3,
      ),
      NOW,
    );
    expect(a.event?.id).toBe(b.event?.id);
    expect(a.event?.id).toBe(eventId("Polenta Pop", "2026-11-29T20:00:00-03:00", "Plaza España"));
  });
});

describe("fechas relativas", () => {
  const now = new Date("2026-11-12T15:00:00Z"); // jueves

  it("resuelve hoy / mañana / ISO", () => {
    expect(resolveDateInput("hoy", now)).toEqual({ year: 2026, month: 11, day: 12 });
    expect(resolveDateInput("mañana", now)).toEqual({ year: 2026, month: 11, day: 13 });
    expect(resolveDateInput("2026-12-01", now)).toEqual({ year: 2026, month: 12, day: 1 });
  });

  it("el finde va del viernes 18:00 al domingo 23:59", () => {
    expect(weekendRange(now)).toEqual({
      from: "2026-11-13T18:00:00-03:00",
      to: "2026-11-15T23:59:00-03:00",
    });
    // sábado: devuelve el finde en curso
    expect(weekendRange(new Date("2026-11-14T15:00:00Z")).from).toBe("2026-11-13T18:00:00-03:00");
    // domingo: idem
    expect(weekendRange(new Date("2026-11-15T15:00:00Z")).from).toBe("2026-11-13T18:00:00-03:00");
  });
});
