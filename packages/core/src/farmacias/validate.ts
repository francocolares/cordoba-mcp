/**
 * Validación de la planilla de guardias. Lógica pura sobre el libro ya
 * parseado: si da `fail`, el ingest no persiste nada (mismo criterio que la
 * agenda, para no dar de baja 850 farmacias por un archivo mal exportado).
 */

import type { Check, ValidationResult } from "../models.js";
import { sha1 } from "../normalize.js";
import { MAX_SECTION, TURNO_CYCLE_LENGTH } from "./config.js";
import { daysInMonth, type ParsedWorkbook } from "./parse.js";

/** Mínimo razonable de farmacias por turno (el más flaco del 2026 tiene 24). */
export const MIN_PHARMACIES_PER_TURNO = 15;

function worst(checks: Check[]): ValidationResult["status"] {
  if (checks.some((c) => c.level === "fail")) return "fail";
  if (checks.some((c) => c.level === "warn")) return "warn";
  return "ok";
}

/**
 * Hash del contenido normalizado. No usamos el hash del .xlsx: el zip que
 * exporta Drive cambia en cada descarga aunque la planilla sea idéntica.
 */
export function workbookContentHash(workbook: ParsedWorkbook): string {
  const days = Object.entries(workbook.days)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, turno]) => `${date}=${turno}`);
  const rows = workbook.rows
    .map((row) => `${row.turno}|${row.section ?? ""}|${row.raw}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sha1([`year=${workbook.year}`, ...days, ...rows].join("\n"));
}

export function daysInYear(year: number): number {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 366 : 365;
}

export function validateWorkbook(
  workbook: ParsedWorkbook,
  options: { at?: string; expectedYear?: number } = {},
): ValidationResult {
  const checks: Check[] = [];

  // 1. Están las 30 hojas de turno.
  const missing: number[] = [];
  for (let turno = 1; turno <= TURNO_CYCLE_LENGTH; turno++) {
    if (!workbook.turnos.includes(turno)) missing.push(turno);
  }
  const extra = workbook.turnos.filter((t) => t < 1 || t > TURNO_CYCLE_LENGTH);
  if (missing.length > 0) {
    checks.push({
      level: "fail",
      code: "turnos_faltantes",
      message: `Faltan hojas de turno: ${missing.join(", ")}`,
    });
  } else {
    checks.push({
      level: "ok",
      code: "turnos_ok",
      message: `Las ${TURNO_CYCLE_LENGTH} hojas de turno están presentes`,
    });
  }
  if (extra.length > 0) {
    checks.push({
      level: "warn",
      code: "turnos_extra",
      message: `Hay hojas de turno fuera del ciclo de ${TURNO_CYCLE_LENGTH}: ${extra.join(", ")}`,
    });
  }

  // 2. El año es el esperado.
  if (options.expectedYear !== undefined && options.expectedYear !== workbook.year) {
    checks.push({
      level: "warn",
      code: "anio_inesperado",
      message: `La planilla es del ${workbook.year} y se esperaba ${options.expectedYear}`,
    });
  }

  // 3. El calendario cubre el año completo.
  const expectedDays = daysInYear(workbook.year);
  const gaps: string[] = [];
  for (let month = 1; month <= 12; month++) {
    for (let day = 1; day <= daysInMonth(workbook.year, month); day++) {
      const date = `${workbook.year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (workbook.days[date] === undefined) gaps.push(date);
    }
  }
  if (gaps.length > 0) {
    checks.push({
      level: "fail",
      code: "calendario_incompleto",
      message: `El calendario tiene ${gaps.length} día(s) sin turno`,
      detail: { primeros: gaps.slice(0, 10) },
    });
  } else {
    checks.push({
      level: "ok",
      code: "calendario_ok",
      message: `El calendario cubre los ${expectedDays} días del ${workbook.year}`,
    });
  }

  // 4. El ciclo de 30 días se respeta. Si no, puede ser un cambio deliberado
  //    del Colegio: avisamos sin bloquear, pero hay que mirarlo.
  const dates = Object.keys(workbook.days).sort();
  const breaks: { date: string; expected: number; found: number }[] = [];
  for (let i = 1; i < dates.length; i++) {
    const previousDate = dates[i - 1]!;
    const date = dates[i]!;
    const consecutive =
      Date.parse(`${date}T00:00:00Z`) - Date.parse(`${previousDate}T00:00:00Z`) === 86_400_000;
    if (!consecutive) continue;
    const expected = (workbook.days[previousDate]! % TURNO_CYCLE_LENGTH) + 1;
    const found = workbook.days[date]!;
    if (found !== expected) breaks.push({ date, expected, found });
  }
  if (breaks.length > 0) {
    checks.push({
      level: "warn",
      code: "ciclo_roto",
      message: `El ciclo de ${TURNO_CYCLE_LENGTH} días se corta en ${breaks.length} fecha(s)`,
      detail: { primeros: breaks.slice(0, 10) },
    });
  } else {
    checks.push({
      level: "ok",
      code: "ciclo_ok",
      message: `La rotación respeta el ciclo de ${TURNO_CYCLE_LENGTH} días`,
    });
  }

  // 5. Cada turno tiene una cantidad razonable de farmacias.
  const perTurno = new Map<number, number>();
  for (const row of workbook.rows) perTurno.set(row.turno, (perTurno.get(row.turno) ?? 0) + 1);
  const empty = workbook.turnos.filter((t) => (perTurno.get(t) ?? 0) === 0);
  const thin = workbook.turnos.filter((t) => {
    const count = perTurno.get(t) ?? 0;
    return count > 0 && count < MIN_PHARMACIES_PER_TURNO;
  });
  if (empty.length > 0) {
    checks.push({
      level: "fail",
      code: "turnos_vacios",
      message: `Turnos sin farmacias: ${empty.join(", ")}`,
    });
  } else if (thin.length > 0) {
    checks.push({
      level: "warn",
      code: "turnos_flacos",
      message: `Turnos con menos de ${MIN_PHARMACIES_PER_TURNO} farmacias: ${thin.join(", ")}`,
    });
  } else {
    checks.push({
      level: "ok",
      code: "farmacias_por_turno_ok",
      message: `Entre ${Math.min(...perTurno.values())} y ${Math.max(...perTurno.values())} farmacias por turno`,
    });
  }

  // 6. Secciones dentro del rango conocido.
  const sections = [...new Set(workbook.rows.map((r) => r.section).filter((s) => s !== null))];
  const outOfRange = sections.filter((s) => s! < 1 || s! > MAX_SECTION);
  if (outOfRange.length > 0) {
    checks.push({
      level: "warn",
      code: "secciones_fuera_de_rango",
      message: `Secciones fuera de 1..${MAX_SECTION}: ${outOfRange.join(", ")}`,
    });
  }
  const sinSeccion = workbook.rows.filter((r) => r.section === null).length;
  if (sinSeccion > 0) {
    checks.push({
      level: "warn",
      code: "filas_sin_seccion",
      message: `${sinSeccion} fila(s) sin sección`,
    });
  }

  // 7. Filas duplicadas y calidad del parseo.
  const counts = new Map<string, number>();
  for (const row of workbook.rows) counts.set(row.raw, (counts.get(row.raw) ?? 0) + 1);
  const duplicated = [...counts.entries()].filter(([, n]) => n > 1).map(([raw]) => raw);
  if (duplicated.length > 0) {
    checks.push({
      level: "warn",
      code: "filas_duplicadas",
      message: `${duplicated.length} fila(s) repetidas en la planilla`,
      detail: { primeras: duplicated.slice(0, 5) },
    });
  }

  const low = workbook.rows.filter((r) => r.parse_confidence === "baja").length;
  const sinDireccion = workbook.rows.filter((r) => r.address === null).length;
  const ratio = workbook.rows.length === 0 ? 1 : low / workbook.rows.length;
  checks.push({
    level: ratio > 0.1 ? "warn" : "info",
    code: "parseo",
    message: `${low} de ${workbook.rows.length} filas sin guion separador; ${sinDireccion} sin dirección`,
  });

  for (const warning of workbook.warnings) {
    checks.push({ level: "warn", code: "planilla", message: warning });
  }

  return {
    at: options.at ?? new Date().toISOString(),
    status: worst(checks),
    checks,
    schema_hash: null,
    bundle_hash: null,
    content_hash: workbookContentHash(workbook),
    row_count: workbook.rows.length,
  };
}
