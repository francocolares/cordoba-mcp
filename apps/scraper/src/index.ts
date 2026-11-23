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

import { type ExportadoresArgs, runCheck, runCrawl, runImport } from "./exportadores.js";
import { type FarmaciasArgs, runGeocode, runIngest } from "./farmacias.js";

const USAGE = `uso: cordoba-scraper <comando> [opciones]

agenda turística (Municipalidad):
  validate   verifica que la fuente no cambió (exit 1 si hay FAIL)
  scrape     baja la planilla y actualiza data/ con histórico
  run        validate + scrape (no scrapea si la validación falla)

farmacias de turno (Colegio de Farmacéuticos):
  farmacias validate   parsea y valida el turnero sin escribir nada
  farmacias ingest     parsea, valida y persiste data/farmacias/
  farmacias geocode    geocodifica lo que falta y actualiza la cache

directorio de exportadores (Agencia ProCórdoba):
  exportadores check     baja sólo el listado (1 request) y dice si cambió
  exportadores import    ingesta un consolidado ya scrapeado (--file)
  exportadores validate  igual que import, sin escribir nada
  exportadores crawl     recorre el directorio ficha por ficha y persiste

opciones:
  --data <dir>     directorio de datos (default: data)
  --file <path>    .xlsx del turnero (default: el snapshot commiteado)
  --url <url>      bajar el turnero de otra URL
  --download       ignorar el snapshot y bajar el turnero de Drive
  --year <aaaa>    año esperado del turnero
  --limit <n>      máximo de fichas o direcciones a procesar en esta tanda
  --ids <a,b,c>    sólo estas fichas del directorio de exportadores
  --retry-failed   reintentar las direcciones que no resolvieron
  --skip-georef    saltear la pasada por lotes de Georef
  --skip-nominatim saltear la pasada de Nominatim (la lenta)
`;

interface Args {
  command: string;
  subcommand: string;
  dataDir: string;
  file?: string | undefined;
  url?: string | undefined;
  year?: number | undefined;
  limit?: number | undefined;
  ids?: string[] | undefined;
  download: boolean;
  retryFailed: boolean;
  skipGeoref: boolean;
  skipNominatim: boolean;
}

function parseArgs(argv: string[]): Args {
  const flag = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const list = (name: string): string[] | undefined => {
    const value = flag(name);
    if (value === undefined) return undefined;
    const ids = value
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id !== "");
    return ids.length === 0 ? undefined : ids;
  };
  const number = (name: string): number | undefined => {
    const value = flag(name);
    if (value === undefined) return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  return {
    command: argv[0] ?? "",
    subcommand: argv[1]?.startsWith("--") ? "" : (argv[1] ?? ""),
    dataDir: flag("data") ?? "data",
    file: flag("file"),
    url: flag("url"),
    year: number("year"),
    limit: number("limit"),
    ids: list("ids"),
    download: argv.includes("--download"),
    retryFailed: argv.includes("--retry-failed"),
    skipGeoref: argv.includes("--skip-georef"),
    skipNominatim: argv.includes("--skip-nominatim"),
  };
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
  const args = parseArgs(process.argv.slice(2));
  const { command, dataDir } = args;
  const paths = dataPaths(dataDir);

  if (command === "farmacias") {
    const farmaciasArgs: FarmaciasArgs = {
      dataDir,
      file: args.file,
      url: args.url,
      year: args.year,
      limit: args.limit,
      download: args.download,
      retryFailed: args.retryFailed,
      skipGeoref: args.skipGeoref,
      skipNominatim: args.skipNominatim,
    };
    if (args.subcommand === "ingest") return runIngest(farmaciasArgs, true);
    if (args.subcommand === "validate") return runIngest(farmaciasArgs, false);
    if (args.subcommand === "geocode") return runGeocode(farmaciasArgs);
    process.stderr.write(USAGE);
    return 2;
  }

  if (command === "exportadores") {
    const exportadoresArgs: ExportadoresArgs = {
      dataDir,
      file: args.file,
      limit: args.limit,
      ids: args.ids,
    };
    if (args.subcommand === "check") return runCheck(exportadoresArgs);
    if (args.subcommand === "import") return runImport(exportadoresArgs, true);
    if (args.subcommand === "validate") return runImport(exportadoresArgs, false);
    if (args.subcommand === "crawl") return runCrawl(exportadoresArgs, true);
    process.stderr.write(USAGE);
    return 2;
  }

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
