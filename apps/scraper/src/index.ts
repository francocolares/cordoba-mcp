#!/usr/bin/env node
import { setDefaultResultOrder } from "node:dns";

// Algunos entornos (WSL2, runners sin IPv6 real) cuelgan al resolver AAAA:
// preferimos IPv4 para que fetch no quede esperando.
setDefaultResultOrder("ipv4first");

import {
  dataPaths,
  loadStatus,
  type RunStatus,
  saveStatus,
  scrape,
  type ValidationResult,
  validateSource,
} from "@cordoba/core";

const USAGE = `uso: cordoba-scraper <comando> [--data <dir>]

comandos:
  validate   verifica que la fuente no cambió (exit 1 si hay FAIL)
  scrape     baja la planilla y actualiza data/ con histórico
  run        validate + scrape (no scrapea si la validación falla)
`;

function parseArgs(argv: string[]): { command: string; dataDir: string } {
  const command = argv[0] ?? "";
  const dataIndex = argv.indexOf("--data");
  const dataDir = dataIndex >= 0 ? (argv[dataIndex + 1] ?? "data") : "data";
  return { command, dataDir };
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function runValidate(dataDir: string): Promise<ValidationResult> {
  const paths = dataPaths(dataDir);
  const previous = await loadStatus(paths);
  const result = await validateSource({ previousBundleHash: previous?.bundle_hash ?? null });
  return result;
}

/** Si no se scrapea, igual dejamos constancia del run en status.json. */
async function saveValidationOnlyStatus(
  dataDir: string,
  validation: ValidationResult,
): Promise<void> {
  const paths = dataPaths(dataDir);
  const previous = await loadStatus(paths);
  const status: RunStatus = {
    last_run: new Date().toISOString(),
    validation,
    scraped: false,
    counts: previous?.counts ?? {
      total: 0,
      active: 0,
      inactive: 0,
      added: 0,
      updated: 0,
      removed: 0,
      readded: 0,
    },
    source: previous?.source ?? "turismo_muni",
    schema_hash: validation.schema_hash ?? previous?.schema_hash ?? null,
    bundle_hash: validation.bundle_hash ?? previous?.bundle_hash ?? null,
  };
  await saveStatus(status, paths);
}

async function main(): Promise<number> {
  const { command, dataDir } = parseArgs(process.argv.slice(2));
  const paths = dataPaths(dataDir);

  if (command === "validate") {
    const result = await runValidate(dataDir);
    printJson(result);
    return result.status === "fail" ? 1 : 0;
  }

  if (command === "scrape") {
    const { status, warnings, rawFile } = await scrape({ paths });
    for (const w of warnings) console.error(`warn: ${w}`);
    printJson({ ...status, raw_file: rawFile, warnings: warnings.length });
    return 0;
  }

  if (command === "run") {
    const validation = await runValidate(dataDir);
    if (validation.status === "fail") {
      await saveValidationOnlyStatus(dataDir, validation);
      console.error("La validación falló: no se ejecuta el scrape para no dar de baja todo.");
      printJson(validation);
      return 1;
    }
    const { status, warnings, rawFile } = await scrape({ paths, validation });
    for (const w of warnings) console.error(`warn: ${w}`);
    printJson({ ...status, raw_file: rawFile, warnings: warnings.length });
    return 0;
  }

  process.stderr.write(USAGE);
  return command === "" || command === "--help" || command === "-h" ? 0 : 2;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  },
);
