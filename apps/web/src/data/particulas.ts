export type Particula = {
  x: number;
  y: number;
  tam: number;
  prof: number;
  giro: number;
  luz: number;
};

const orbita: Particula[] = [
  { x: 6, y: 12, tam: 3.4, prof: 0.9, giro: -12, luz: 0.8 },
  { x: 20, y: 4, tam: 2, prof: 0.5, giro: 16, luz: 0.5 },
  { x: 22, y: 20, tam: 1.7, prof: 0.35, giro: -18, luz: 0.42 },
  { x: 15, y: 36, tam: 2.2, prof: 0.55, giro: 8, luz: 0.56 },
  { x: 4, y: 58, tam: 2.8, prof: 0.75, giro: -6, luz: 0.62 },
  { x: 24, y: 66, tam: 2.4, prof: 0.65, giro: 5, luz: 0.5 },
  { x: 14, y: 82, tam: 2, prof: 0.4, giro: 14, luz: 0.45 },
  { x: 3, y: 92, tam: 3, prof: 0.85, giro: -9, luz: 0.55 },
  { x: 40, y: 3, tam: 2.2, prof: 0.5, giro: 9, luz: 0.45 },
  { x: 84, y: 5, tam: 1.8, prof: 0.35, giro: -20, luz: 0.4 },
  { x: 78, y: 12, tam: 3, prof: 0.8, giro: 10, luz: 0.7 },
  { x: 93, y: 32, tam: 2.6, prof: 0.6, giro: -7, luz: 0.56 },
  { x: 76, y: 54, tam: 2.2, prof: 0.45, giro: 12, luz: 0.46 },
  { x: 89, y: 74, tam: 3.2, prof: 0.9, giro: -14, luz: 0.65 },
  { x: 74, y: 88, tam: 2, prof: 0.4, giro: 6, luz: 0.42 },
  { x: 96, y: 94, tam: 1.8, prof: 0.3, giro: 20, luz: 0.36 },
  { x: 60, y: 96, tam: 2.4, prof: 0.55, giro: -8, luz: 0.45 },
  { x: 48, y: 98, tam: 1.6, prof: 0.3, giro: 15, luz: 0.35 },
];

const POR_ENJAMBRE = 10;
const ARRANQUE = 5;
const PASO = 7;

export function enjambre(indice: number): Particula[] {
  const desde = (indice * ARRANQUE) % orbita.length;
  return Array.from({ length: POR_ENJAMBRE }, (_, i) => orbita[(desde + i * PASO) % orbita.length]);
}
