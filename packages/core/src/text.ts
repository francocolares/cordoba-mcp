/** Quita tildes/diacríticos (útil para búsquedas e IDs estables). */
export function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

/** minúsculas, sin tildes, espacios colapsados. */
export function normalizeKey(value: string | null | undefined): string {
  if (!value) return "";
  return stripAccents(value).toLowerCase().replace(/\s+/g, " ").trim();
}

export function truncate(value: string | null, max: number): string | null {
  if (value === null) return null;
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}
