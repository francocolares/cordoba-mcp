/**
 * Carga de los datos desde R2.
 *
 * Antes los datasets viajaban embebidos en el bundle (`data.generated.ts`): eso
 * ataba cada actualización de datos a un deploy del Worker y hacía crecer el
 * bundle con cada colección. Ahora los sube el workflow que scrapea
 * (`scripts/sync-r2.mjs`) y el Worker los lee de R2, así que el cron de cada
 * fuente es independiente del deploy del código.
 *
 * El `manifest.json` es lo único mutable: dice, por colección, qué objeto tiene
 * los registros y cuáles son los extras, con el hash del contenido. Las claves
 * de los objetos son estables (se sobrescriben), y el hash se usa como versión
 * de la caché: cuando cambia, cambia la cache key y el contenido viejo caduca
 * solo. Hay una ventana de hasta `MANIFEST_TTL_MS` en la que un isolate puede
 * seguir viendo el manifest anterior; para snapshots diarios es inocuo.
 *
 * Sin respaldo embebido a propósito: si R2 no responde, las colecciones quedan
 * en `null` y las tools contestan `source_unavailable`, que es un estado que la
 * API ya modela y que `source_status` reporta.
 */
import { COLLECTIONS, type Snapshot } from "@cordoba/core/web";

export const MANIFEST_KEY = "manifest.json";

/** Vida del manifest en el isolate. Es la latencia máxima de un dato nuevo. */
export const MANIFEST_TTL_MS = 60_000;

export interface ManifestFile {
  key: string;
  hash: string;
  bytes: number;
}

export interface ManifestCollection {
  data_as_of: string | null;
  records: ManifestFile;
  extras: Record<string, ManifestFile>;
}

export interface Manifest {
  version: 1;
  generated_at: string;
  collections: Record<string, ManifestCollection>;
}

/** Lo mínimo de R2 que usamos. Los tests pasan un doble con esta forma. */
export interface DataBucket {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
}

export interface LoadedData {
  snapshot: Snapshot;
  manifest: Manifest | null;
  /** Qué salió mal, si salió mal. Viaja en /health, no en las respuestas MCP. */
  error: string | null;
  loaded_at: number;
}

let cached: LoadedData | null = null;

/** Stores ya parseados, por hash del contenido: evita re-parsear al refrescar. */
const stores = new Map<string, unknown>();

/** Caché del runtime; en Node (tests) no existe y se trabaja sin ella. */
function edgeCache(): Cache | null {
  return typeof caches === "undefined" ? null : caches.default;
}

async function readText(bucket: DataBucket, file: ManifestFile): Promise<string | null> {
  // La clave lleva el hash: una entrada de caché nunca se invalida, caduca.
  const request = new Request(`https://r2.cordoba.invalid/${file.key}?v=${file.hash}`);
  const cache = edgeCache();
  try {
    const hit = await cache?.match(request);
    if (hit) return await hit.text();
  } catch {
    // Caché inaccesible: seguimos contra R2.
  }

  const object = await bucket.get(file.key);
  if (!object) return null;
  const text = await object.text();

  try {
    await cache?.put(
      request,
      new Response(text, {
        headers: { "cache-control": "public, max-age=86400, immutable" },
      }),
    );
  } catch {
    // Que no se pueda cachear no es motivo para fallar la respuesta.
  }
  return text;
}

async function readManifest(bucket: DataBucket): Promise<Manifest> {
  const object = await bucket.get(MANIFEST_KEY);
  if (!object) throw new Error(`no hay ${MANIFEST_KEY} en el bucket`);
  const manifest = JSON.parse(await object.text()) as Manifest;
  if (manifest.version !== 1 || typeof manifest.collections !== "object") {
    throw new Error(`${MANIFEST_KEY} con formato inesperado`);
  }
  return manifest;
}

async function hydrateAll(bucket: DataBucket, manifest: Manifest): Promise<Snapshot> {
  const snapshot: Snapshot = {};

  for (const collection of COLLECTIONS) {
    const id = collection.descriptor.id;
    const entry = manifest.collections[id];
    if (!entry) {
      snapshot[id] = null;
      continue;
    }

    const extraNames = Object.keys(entry.extras).sort();
    const cacheKey = [id, entry.records.hash, ...extraNames.map((n) => entry.extras[n]?.hash)].join(
      "|",
    );
    const memo = stores.get(cacheKey);
    if (memo !== undefined) {
      snapshot[id] = memo;
      continue;
    }

    const [records, ...extraTexts] = await Promise.all([
      readText(bucket, entry.records),
      ...extraNames.map((name) => readText(bucket, entry.extras[name] as ManifestFile)),
    ]);
    const extras: Record<string, string | null> = {};
    extraNames.forEach((name, i) => {
      extras[name] = extraTexts[i] ?? null;
    });

    const store = collection.hydrate({ records: records ?? null, extras });
    snapshot[id] = store;
    if (store !== null) {
      // Una entrada por hash. El Map vive en el isolate, que es efímero.
      if (stores.size > 16) stores.clear();
      stores.set(cacheKey, store);
    }
  }

  return snapshot;
}

/** Todas las colecciones en `null`: lo que ve el MCP cuando R2 no está. */
function emptySnapshot(): Snapshot {
  const snapshot: Snapshot = {};
  for (const collection of COLLECTIONS) snapshot[collection.descriptor.id] = null;
  return snapshot;
}

/**
 * Snapshot listo para los handlers, con cache de `MANIFEST_TTL_MS` en el
 * isolate. Nunca lanza: un problema de datos se reporta como colección no
 * disponible.
 */
export async function loadData(
  bucket: DataBucket | undefined,
  now: number = Date.now(),
): Promise<LoadedData> {
  if (cached && now - cached.loaded_at < MANIFEST_TTL_MS) return cached;

  if (!bucket) {
    cached = {
      snapshot: emptySnapshot(),
      manifest: null,
      error: "falta el binding DATA del bucket de R2",
      loaded_at: now,
    };
    return cached;
  }

  try {
    const manifest = await readManifest(bucket);
    const snapshot = await hydrateAll(bucket, manifest);
    cached = { snapshot, manifest, error: null, loaded_at: now };
  } catch (err) {
    // Si había un snapshot bueno lo conservamos y reintentamos al próximo TTL:
    // es preferible servir un dato de hace un rato que no servir nada.
    const message = err instanceof Error ? err.message : String(err);
    cached = cached
      ? { ...cached, error: message, loaded_at: now }
      : { snapshot: emptySnapshot(), manifest: null, error: message, loaded_at: now };
  }
  return cached;
}

/** Sólo para los tests: vacía la cache del módulo. */
export function resetDataCache(): void {
  cached = null;
  stores.clear();
}
