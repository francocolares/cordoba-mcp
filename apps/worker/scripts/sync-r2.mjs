#!/usr/bin/env node
/**
 * Sube los datasets de `data/` a R2 y escribe el `manifest.json` que lee el
 * Worker (ver apps/worker/src/data.ts).
 *
 * Lo corre el workflow que scrapea, no el deploy: así una actualización de
 * datos no necesita publicar el Worker de nuevo.
 *
 *   node apps/worker/scripts/sync-r2.mjs                  # contra R2 (credenciales del env)
 *   node apps/worker/scripts/sync-r2.mjs --local          # contra el R2 simulado de `wrangler dev`
 *   node apps/worker/scripts/sync-r2.mjs --dry-run        # sólo dice qué subiría
 *   node apps/worker/scripts/sync-r2.mjs --ensure-bucket  # crea el bucket si no existe
 *
 * Las claves de los objetos son **estables** (se sobrescriben) y el manifest
 * lleva el hash del contenido: el Worker lo usa como versión de caché, y así no
 * queda basura acumulada en el bucket. El manifest se sube **último**, cuando
 * los objetos que referencia ya están arriba.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const workerDir = resolve(here, "..");
const repoRoot = resolve(workerDir, "../..");

/**
 * De dónde sale cada archivo de cada colección. Es el único lugar que conoce el
 * layout de `data/`: los nombres (`records`, `status.json`, …) son los que
 * `collection.hydrate()` espera recibir.
 */
export const COLLECTION_FILES = {
  eventos: {
    records: { path: "events.jsonl", contentType: "application/x-ndjson" },
    extras: {
      "status.json": { path: "status.json", contentType: "application/json" },
    },
  },
  exportadores: {
    records: { path: "exportadores/companies.jsonl", contentType: "application/x-ndjson" },
    extras: {
      "status.json": { path: "exportadores/status.json", contentType: "application/json" },
    },
  },
  farmacias_turno: {
    records: { path: "farmacias/pharmacies.jsonl", contentType: "application/x-ndjson" },
    extras: {
      "status.json": { path: "farmacias/status.json", contentType: "application/json" },
      "turnos.json": { path: "farmacias/turnos.json", contentType: "application/json" },
    },
  },
};

const hash = (text) => createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12);

function readOptional(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

const dataAsOf = (statusText, recordsText) => {
  try {
    const status = statusText ? JSON.parse(statusText) : null;
    if (status?.last_run) return status.last_run;
  } catch {
    // status ilegible: caemos al last_seen de los registros.
  }
  let latest = null;
  for (const line of (recordsText ?? "").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const seen = JSON.parse(line).last_seen;
      if (seen && (latest === null || seen > latest)) latest = seen;
    } catch {
      // línea rota: la valida el parser de core, no este script.
    }
  }
  return latest;
};

/**
 * Arma el manifest y la lista de objetos a subir, leyendo `dataDir`. Lo usan el
 * script y los tests (así los tests ejercitan este mismo armado).
 */
export function buildManifest(dataDir = join(repoRoot, "data"), now = new Date()) {
  const collections = {};
  const objects = [];

  for (const [id, spec] of Object.entries(COLLECTION_FILES)) {
    const recordsText = readOptional(join(dataDir, spec.records.path));
    if (recordsText === null) continue;

    const records = {
      key: `${id}/records.jsonl`,
      hash: hash(recordsText),
      bytes: Buffer.byteLength(recordsText, "utf8"),
    };
    objects.push({ ...records, text: recordsText, contentType: spec.records.contentType });

    const extras = {};
    let statusText = null;
    for (const [name, extra] of Object.entries(spec.extras)) {
      const text = readOptional(join(dataDir, extra.path));
      if (text === null) continue;
      if (name === "status.json") statusText = text;
      const file = {
        key: `${id}/${name}`,
        hash: hash(text),
        bytes: Buffer.byteLength(text, "utf8"),
      };
      extras[name] = file;
      objects.push({ ...file, text, contentType: extra.contentType });
    }

    collections[id] = { data_as_of: dataAsOf(statusText, recordsText), records, extras };
  }

  const manifest = { version: 1, generated_at: now.toISOString(), collections };
  return { manifest, objects };
}

/** Lee el nombre del bucket del wrangler.jsonc, para no duplicarlo acá. */
export function bucketName(configPath = join(workerDir, "wrangler.jsonc")) {
  const raw = readFileSync(configPath, "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const config = JSON.parse(raw);
  const bucket = config.r2_buckets?.[0]?.bucket_name;
  if (!bucket) throw new Error("wrangler.jsonc no declara r2_buckets[0].bucket_name");
  return bucket;
}

/* ------------------------------------------------------------- main ------ */

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const local = args.includes("--local");
  const dryRun = args.includes("--dry-run");
  const dataDir = args.find((a) => a.startsWith("--data-dir="))?.split("=")[1];

  const ensureBucket = args.includes("--ensure-bucket");
  const bucket = bucketName();
  const { manifest, objects } = buildManifest(dataDir ? resolve(dataDir) : undefined);
  const scope = local ? "--local" : "--remote";

  if (Object.keys(manifest.collections).length === 0) {
    console.error("[sync-r2] no encontré ningún dataset en data/: nada que subir.");
    process.exit(1);
  }

  const tmp = mkdtempSync(join(tmpdir(), "sync-r2-"));
  const wrangler = (wranglerArgs) => {
    const res = spawnSync("npx", ["wrangler", ...wranglerArgs], {
      cwd: workerDir,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    return { ok: res.status === 0, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
  };

  // Crear el bucket es idempotente y lo hace la Action: así un deploy nunca
  // falla por un bucket que no existe todavía. Necesita que el token tenga
  // "Workers R2 Storage: Edit" y que la cuenta tenga R2 habilitado.
  if (ensureBucket && !local && !dryRun) {
    const created = wrangler(["r2", "bucket", "create", bucket]);
    if (created.ok) console.log(`[sync-r2] bucket ${bucket} creado.`);
    else if (/already (exists|owned)/i.test(created.out)) {
      console.log(`[sync-r2] bucket ${bucket} ya existía.`);
    } else {
      console.error(`[sync-r2] no pude crear el bucket ${bucket}:\n${created.out.trim()}`);
      console.error(
        "[sync-r2] si habla del token, falta el permiso Workers R2 Storage: Edit;\n" +
          "          si habla de la cuenta, hay que activar R2 una vez en el dashboard.",
      );
      process.exit(1);
    }
  }

  // El manifest que hay arriba nos dice qué objetos no hace falta volver a subir.
  const previousPath = join(tmp, "previous.json");
  const fetched = wrangler([
    "r2",
    "object",
    "get",
    `${bucket}/manifest.json`,
    `--file=${previousPath}`,
    scope,
  ]);
  let previous = null;
  if (fetched.ok) {
    try {
      previous = JSON.parse(readFileSync(previousPath, "utf8"));
    } catch {
      previous = null;
    }
  } else {
    console.log("[sync-r2] sin manifest previo (primera carga o bucket nuevo).");
  }

  const hashesArriba = new Set();
  for (const entry of Object.values(previous?.collections ?? {})) {
    hashesArriba.add(`${entry.records.key}:${entry.records.hash}`);
    for (const file of Object.values(entry.extras ?? {})) {
      hashesArriba.add(`${file.key}:${file.hash}`);
    }
  }

  const pendientes = objects.filter((o) => !hashesArriba.has(`${o.key}:${o.hash}`));
  console.log(
    `[sync-r2] bucket ${bucket} (${local ? "local" : "remoto"}): ` +
      `${objects.length} objetos, ${pendientes.length} con cambios.`,
  );

  if (dryRun) {
    for (const o of pendientes) console.log(`  subiría ${o.key} (${o.bytes} bytes, ${o.hash})`);
    console.log("[sync-r2] --dry-run: no subí nada.");
    process.exit(0);
  }

  const put = (key, text, contentType) => {
    const file = join(tmp, key.replace(/\//g, "_"));
    writeFileSync(file, text, "utf8");
    const res = wrangler([
      "r2",
      "object",
      "put",
      `${bucket}/${key}`,
      `--file=${file}`,
      `--content-type=${contentType}`,
      scope,
      "--force",
    ]);
    if (!res.ok) {
      console.error(`[sync-r2] falló la subida de ${key}:\n${res.out}`);
      process.exit(1);
    }
    console.log(`  ✓ ${key} (${Buffer.byteLength(text, "utf8")} bytes)`);
  };

  for (const object of pendientes) put(object.key, object.text, object.contentType);
  // Último: así nunca apunta a un objeto que todavía no está arriba.
  put("manifest.json", `${JSON.stringify(manifest, null, 1)}\n`, "application/json");

  const resumen = Object.entries(manifest.collections)
    .map(([id, c]) => `${id} (${c.records.bytes} bytes, as_of ${c.data_as_of ?? "?"})`)
    .join(" | ");
  console.log(`[sync-r2] listo: ${resumen}`);
}
