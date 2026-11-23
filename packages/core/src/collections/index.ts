/**
 * El catálogo. Sumar una colección (o una fuente a una colección existente) es
 * agregar una línea acá: ni las tools ni su JSON Schema cambian, así que los
 * clientes conectados no tienen que reconectar para ver datos nuevos.
 */
import type { Collection } from "../collections.js";
import { DataError } from "../errors.js";
import { eventos } from "./eventos.js";
import { exportadores } from "./exportadores.js";
import { farmaciasTurno } from "./farmaciasTurno.js";

export * from "./eventos.js";
export * from "./exportadores.js";
export * from "./farmaciasTurno.js";

export const COLLECTIONS: readonly Collection<unknown>[] = [eventos, farmaciasTurno, exportadores];

export const COLLECTION_IDS: readonly string[] = COLLECTIONS.map((c) => c.descriptor.id);

export function findCollection(id: unknown): Collection<unknown> {
  const found = COLLECTIONS.find((c) => c.descriptor.id === id);
  if (found) return found;
  throw new DataError("unknown_collection", `No existe la colección "${String(id)}"`, {
    hint: "Llamá a list_collections para ver el catálogo.",
    valid_values: [...COLLECTION_IDS],
  });
}

/** djb2. No es criptográfico: sólo le dice al modelo si el catálogo cambió. */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Huella del catálogo. Viaja en cada respuesta: es lo que le permite a un
 * cliente (o a un modelo con un `list_collections` viejo en contexto) notar que
 * hay datos nuevos, sin notificaciones ni reconexión.
 */
export const CATALOG_VERSION: string = hash(JSON.stringify(COLLECTIONS.map((c) => c.descriptor)));
