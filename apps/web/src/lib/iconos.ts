/**
 * Los íconos de las fuentes, por nombre del set `lucide` de Iconify. El tipo
 * vive acá y no en `SourceIcon.astro` porque esbuild no digiere una unión
 * exportada desde el frontmatter de un `.astro`.
 */
export const ICONOS_FUENTE = [
  "calendar-days",
  "pill",
  "hospital",
  "bus",
  "film",
  "landmark",
  "ferris-wheel",
  "library",
  "mountain-snow",
  "trees",
  "traffic-cone",
  "waves",
  "map",
  "shopping-basket",
  "circle-parking",
  "stamp",
  "newspaper",
  "layers",
  "trending-up",
  "wheat",
  "flame",
  "satellite",
] as const;

export type SourceIconName = (typeof ICONOS_FUENTE)[number];
