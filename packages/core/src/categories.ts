import type { Category } from "./models.js";
import { stripAccents } from "./text.js";

/**
 * `Tipo de Evento` es texto libre (unas 25 variantes). Mapeamos por keywords a
 * un set canónico chico. El orden importa: gana la primera regla que matchea.
 */
const RULES: readonly [Category, readonly string[]][] = [
  ["infantil", ["infantil", "infancia", "ninos", "nines"]],
  ["visita_guiada", ["visita guiada", "visitas guiadas", "recorrido", "city tour", "paseo"]],
  ["humor", ["humor", "stand up", "stand-up", "standup", "comedia", "comico"]],
  ["streaming", ["streaming", "online", "virtual"]],
  ["gastronomia", ["gastronom", "comida", "cerve", "vino", "food", "feria de sabores"]],
  ["feria", ["feria", "expo", "mercado"]],
  ["conferencia", ["conferencia", "charla", "seminario", "congreso", "jornada", "taller"]],
  ["teatro", ["teatro", "obra", "dramaturg", "performance", "circo", "unipersonal"]],
  ["musica", ["musica", "concierto", "recital", "sinfonic", "orquesta", "coro", "banda", "dj"]],
  ["danza", ["danza", "ballet", "bachata", "salsa", "tango", "folclor", "folklor", "baile"]],
  ["fiesta", ["fiesta", "festival", "peña", "pena", "after", "club"]],
  ["museos_cultura", ["museo", "cultura", "patrimonio", "arte", "exposic", "muestra", "cine"]],
];

export interface CategoryMatch {
  category: Category;
  matched: boolean;
}

export function classify(raw: string | null | undefined): CategoryMatch {
  if (!raw) return { category: "otro", matched: false };
  const hay = stripAccents(raw.trim().toLowerCase());
  for (const [category, keywords] of RULES) {
    if (keywords.some((k) => hay.includes(stripAccents(k)))) {
      return { category, matched: true };
    }
  }
  return { category: "otro", matched: false };
}
