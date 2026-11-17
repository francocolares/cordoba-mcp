/**
 * Ids con prefijo: `<collection>:<source>:<id_local>`.
 *
 * El prefijo se arma al serializar, no se guarda: en los .jsonl el id sigue
 * siendo el local (sha1 de 12 hex para eventos, `<slug>-<n>` para farmacias),
 * así que esto no obliga a re-ingestar nada. Con el prefijo, `get` sabe a qué
 * colección pegarle sin recibir un parámetro extra.
 */
import { DataError } from "./errors.js";

export interface ParsedId {
  /** null cuando llega un id pelado (compatibilidad con los ids viejos). */
  collection: string | null;
  source: string | null;
  local: string;
}

export function formatId(collection: string, source: string, local: string): string {
  return `${collection}:${source}:${local}`;
}

export function parseId(raw: string): ParsedId {
  const value = raw.trim();
  if (value === "") throw new DataError("invalid_id", "El id está vacío");
  const parts = value.split(":");
  if (parts.length === 1) return { collection: null, source: null, local: parts[0] as string };
  if (parts.length === 3) {
    const [collection, source, local] = parts as [string, string, string];
    if (collection === "" || local === "") {
      throw new DataError("invalid_id", `Id mal formado: "${raw}"`, {
        hint: "El formato es <collection>:<source>:<id_local>",
      });
    }
    return { collection, source, local };
  }
  throw new DataError("invalid_id", `Id mal formado: "${raw}"`, {
    hint: "El formato es <collection>:<source>:<id_local>",
  });
}
