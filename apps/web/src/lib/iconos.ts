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
  "container",
] as const;

export type SourceIconName = (typeof ICONOS_FUENTE)[number];

/**
 * Los íconos de las vías de contribución. Van en su propia lista —y no
 * sumados a las fuentes— porque no rotulan un organismo: rotulan una forma de
 * empujar el proyecto.
 */
export const ICONOS_CONTRIBUIR = ["heart-handshake", "server"] as const;

export type ContribIconName = (typeof ICONOS_CONTRIBUIR)[number];

/**
 * Los íconos que pueden ir adentro de un botón, para anticipar qué abre:
 * `calendar-check` en el que lleva al calendario. Los de marca (WhatsApp,
 * GitHub) no salen de acá: viven en el set `logos` y los dibuja `BrandIcon`.
 */
export const ICONOS_CTA = ["calendar-check"] as const;

export type CtaIconName = (typeof ICONOS_CTA)[number];

/** Todo lo que `SourceIcon` sabe dibujar del set `lucide`. */
export type LucideIconName = SourceIconName | ContribIconName | CtaIconName;
