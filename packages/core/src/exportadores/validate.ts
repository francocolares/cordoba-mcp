import type { Check, ValidationResult } from "../models.js";
import { sha1 } from "../normalize.js";
import { EXPORTER_PROFILES, UNRESOLVED_PROFILE } from "./config.js";
import type { ExportadoresStatus, Exporter } from "./models.js";
import type { ExcludedCounts } from "./normalize.js";

export const MAX_DIRECTORY_DROP = 0.1;

export const MIN_PUBLISHABLE_RATIO = 0.5;

export const COVERAGE_BASELINE = {
  website: 0.75,
  sectors: 0.95,
  exportable_offer: 0.9,
  description: 0.95,
} as const;

export interface ValidateExportersInput {
  exporters: readonly Exporter[];
  directoryTotal: number;
  excluded: ExcludedCounts;
  previous?: ExportadoresStatus | null;
  at?: string;
  partial?: boolean;
}

function worst(checks: readonly Check[]): ValidationResult["status"] {
  if (checks.some((c) => c.level === "fail")) return "fail";
  if (checks.some((c) => c.level === "warn")) return "warn";
  return "ok";
}

export function exportersContentHash(exporters: readonly Exporter[]): string {
  const lines = exporters.map((e) => `${e.id}=${e.content_hash}`).sort();
  return sha1(lines.join("\n"));
}

const ratio = (part: number, total: number): number => (total === 0 ? 0 : part / total);

export function validateExporters(input: ValidateExportersInput): ValidationResult {
  const { exporters, directoryTotal, excluded } = input;
  const partial = input.partial === true;
  const checks: Check[] = [];
  const total = exporters.length;

  if (directoryTotal === 0) {
    checks.push({
      level: "fail",
      code: "listado_vacio",
      message: "El listado no trajo ninguna ficha: el template del sitio cambió",
    });
  }

  if (total === 0) {
    checks.push({
      level: "fail",
      code: "sin_fichas_publicables",
      message: "Ninguna ficha quedó publicable",
      detail: { directoryTotal, excluded },
    });
  } else {
    checks.push({
      level: "ok",
      code: "fichas",
      message: `${total} fichas publicables de ${directoryTotal} del directorio`,
      detail: {
        excluidas_personas_humanas: excluded.naturalPersons,
        excluidas_sin_contenido: excluded.withoutContent,
      },
    });
  }

  const publishable = ratio(total, directoryTotal);
  if (!partial && directoryTotal > 0 && publishable < MIN_PUBLISHABLE_RATIO) {
    checks.push({
      level: "fail",
      code: "publicables_bajo",
      message:
        `Sólo ${Math.round(publishable * 100)}% de las fichas quedaron publicables ` +
        `(mínimo ${Math.round(MIN_PUBLISHABLE_RATIO * 100)}%)`,
      detail: { total, directoryTotal, excluded },
    });
  }

  const previousTotal = input.previous?.counts.total ?? 0;
  if (!partial && previousTotal > 0 && total > 0) {
    const drop = (previousTotal - total) / previousTotal;
    if (drop > MAX_DIRECTORY_DROP) {
      checks.push({
        level: "fail",
        code: "caida_del_padron",
        message: `El padrón cayó ${Math.round(drop * 100)}%: ${previousTotal} -> ${total}`,
        detail: { previousTotal, total },
      });
    }
  }

  const profiles = new Set(
    exporters.map((e) => e.exporter_profile).filter((p): p is string => p !== null),
  );
  const unknown = [...profiles].filter(
    (profile) => !(EXPORTER_PROFILES as readonly string[]).includes(profile),
  );
  if (unknown.length > 0) {
    checks.push({
      level: "warn",
      code: "perfiles_desconocidos",
      message: `Perfiles exportadores que no están en el catálogo: ${unknown.join(", ")}`,
      detail: { valid_values: [...EXPORTER_PROFILES] },
    });
  }

  const withoutProfile = exporters.filter((e) => e.exporter_profile === null).length;
  if (withoutProfile > 0) {
    checks.push({
      level: "info",
      code: "perfil_sin_resolver",
      message:
        `${withoutProfile} ficha(s) sin perfil exportador: la fuente renderiza ` +
        `"${UNRESOLVED_PROFILE}" sin resolver y se guarda en null`,
    });
  }

  const coverage = {
    website: ratio(exporters.filter((e) => e.website !== null).length, total),
    sectors: ratio(exporters.filter((e) => e.sectors.length > 0).length, total),
    exportable_offer: ratio(exporters.filter((e) => e.exportable_offer.length > 0).length, total),
    description: ratio(exporters.filter((e) => e.description !== null).length, total),
  };
  for (const [field, floor] of Object.entries(COVERAGE_BASELINE)) {
    const measured = coverage[field as keyof typeof coverage];
    if (total > 0 && measured < floor) {
      checks.push({
        level: "warn",
        code: "cobertura_baja",
        message:
          `${field}: ${Math.round(measured * 100)}% de las fichas, por debajo del ` +
          `${Math.round(floor * 100)}% esperado`,
      });
    }
  }
  checks.push({
    level: "info",
    code: "cobertura",
    message: Object.entries(coverage)
      .map(([field, value]) => `${field} ${Math.round(value * 100)}%`)
      .join(", "),
  });

  if (partial) {
    checks.push({
      level: "info",
      code: "recorrido_parcial",
      message:
        "Tanda parcial: no se comparan totales ni se dan de baja las fichas que no se visitaron",
    });
  }

  return {
    at: input.at ?? new Date().toISOString(),
    status: worst(checks),
    checks,
    schema_hash: null,
    bundle_hash: null,
    content_hash: exportersContentHash(exporters),
    row_count: total,
  };
}
