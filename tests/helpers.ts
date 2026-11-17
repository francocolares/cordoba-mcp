// @ts-expect-error - el script es .mjs sin tipos; el contrato lo fija R2Double.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildManifest } from "../apps/worker/scripts/sync-r2.mjs";

export const fixturesDir = join(import.meta.dirname, "fixtures");

export function fixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

/**
 * Doble del bucket de R2, servido desde `data/` con el mismo armado de manifest
 * que usa el deploy (`apps/worker/scripts/sync-r2.mjs`): así los tests ejercitan
 * ese armado en vez de una copia.
 */

export interface R2Double {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  files: Map<string, string>;
  manifest: {
    version: number;
    generated_at: string;
    collections: Record<
      string,
      {
        data_as_of: string | null;
        records: { key: string; hash: string; bytes: number };
        extras: Record<string, { key: string; hash: string; bytes: number }>;
      }
    >;
  };
  /** Objetos pedidos a R2, en orden: sirve para ver qué se cacheó. */
  reads: string[];
}

export function r2FromDataDir(dataDir = join(import.meta.dirname, "..", "data")): R2Double {
  const { manifest, objects } = buildManifest(dataDir) as {
    manifest: R2Double["manifest"];
    objects: { key: string; text: string }[];
  };
  const files = new Map<string, string>(objects.map((o) => [o.key, o.text]));
  files.set("manifest.json", JSON.stringify(manifest, null, 1));
  const reads: string[] = [];
  return {
    files,
    manifest,
    reads,
    get: async (key: string) => {
      reads.push(key);
      const text = files.get(key);
      return text === undefined ? null : { text: async () => text };
    },
  };
}

/** Bucket vacío: lo que ve el Worker si R2 está caído o sin sembrar. */
export function emptyR2(): R2Double {
  const double = r2FromDataDir();
  double.files.clear();
  return double;
}
