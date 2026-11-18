/**
 * Los cinco planos del isotipo de Córdoba plegado, del más alto al más bajo.
 *
 * Viven acá porque los comparten el fondo del hero (OrigamiCordoba, que les
 * aplica parallax usando `d` como profundidad) y la marca del pie
 * (CordobaMark, que los dibuja quietos). El viewBox nativo es
 * `-6 -6 76 112`: los puntos van en esas unidades.
 */
export type Plano = {
  points: string;
  fill: string;
  /** Profundidad: cuánto se mueve el plano cuando hay parallax. */
  d: number;
};

export const planosIsotipo: Plano[] = [
  { points: "0,46 7,26 12,0 56,4", fill: "#4a4540", d: 1 },
  { points: "0,46 56,4 62,26 15,58", fill: "#302c29", d: 0.55 },
  { points: "15,58 62,26 55,45 63,63", fill: "#3d3933", d: 0.8 },
  { points: "15,58 63,63 45,90 37,90", fill: "#231f1d", d: 0.3 },
  { points: "15,58 37,90 37,100 10,100", fill: "#2b2724", d: 0.45 },
];

/** Brillo relativo del hex, 0 a 1, para ordenar los planos por luz. */
function brillo(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

const maximoBrillo = Math.max(...planosIsotipo.map((p) => brillo(p.fill)));

/**
 * El isotipo a una sola tinta: lo que distingue un plano de otro es la
 * opacidad, derivada del brillo de su tinta original. El plano más claro queda
 * opaco y el resto baja en proporción, con piso para que ninguno desaparezca.
 *
 * Lo comparten `CordobaMark` (la marca del header y el pie, en `currentColor`)
 * y el favicon (`src/pages/favicon.svg.ts`), así los tres pliegues son el mismo
 * dibujo y no se desincronizan.
 */
export const planosIsotipoMono: { points: string; opacity: string }[] = planosIsotipo.map((p) => ({
  points: p.points,
  opacity: Math.max(0.42, brillo(p.fill) / maximoBrillo).toFixed(2),
}));

/** El viewBox en el que están escritos los `points` de la versión a una tinta. */
export const ISOTIPO_VIEWBOX = { width: 63, height: 100 } as const;
