export const PLIEGUES_VIEWBOX = { width: 120, height: 100 } as const;

export const CAPAS = 4;

export type Faceta = {
  points: string;
  luz: number;
};

const COLUMNAS = 5;
const FILAS = 3;
const SEMILLA = 7440794;
const JUEGO = 0.52;

function sorteador(semilla: number) {
  let estado = semilla % 2147483647;
  return () => {
    estado = (estado * 48271) % 2147483647;
    return estado / 2147483647;
  };
}

type Punto = { x: number; y: number };

function grilla(sortear: () => number): Punto[][] {
  const anchoCelda = PLIEGUES_VIEWBOX.width / COLUMNAS;
  const altoCelda = PLIEGUES_VIEWBOX.height / FILAS;

  return Array.from({ length: FILAS + 1 }, (_, fila) =>
    Array.from({ length: COLUMNAS + 1 }, (_, columna) => {
      const enBorde = columna === 0 || columna === COLUMNAS || fila === 0 || fila === FILAS;
      const desvio = enBorde ? 0 : JUEGO;
      return {
        x: columna * anchoCelda + (sortear() - 0.5) * anchoCelda * desvio,
        y: fila * altoCelda + (sortear() - 0.5) * altoCelda * desvio,
      };
    }),
  );
}

function triangulo(a: Punto, b: Punto, c: Punto): string {
  return [a, b, c].map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
}

function plegar(): Faceta[][] {
  const sortear = sorteador(SEMILLA);
  const puntos = grilla(sortear);
  const capas: Faceta[][] = Array.from({ length: CAPAS }, () => []);

  for (let fila = 0; fila < FILAS; fila++) {
    for (let columna = 0; columna < COLUMNAS; columna++) {
      const arribaIzq = puntos[fila][columna];
      const arribaDer = puntos[fila][columna + 1];
      const abajoIzq = puntos[fila + 1][columna];
      const abajoDer = puntos[fila + 1][columna + 1];
      const diagonalPar = (fila + columna) % 2 === 0;

      const caras = diagonalPar
        ? [triangulo(arribaIzq, arribaDer, abajoDer), triangulo(arribaIzq, abajoDer, abajoIzq)]
        : [triangulo(arribaIzq, arribaDer, abajoIzq), triangulo(arribaDer, abajoDer, abajoIzq)];

      for (const points of caras) {
        const luz = Number((0.18 + sortear() * 0.82).toFixed(3));
        const capa = Math.min(CAPAS - 1, Math.floor(luz * CAPAS));
        capas[capa].push({ points, luz });
      }
    }
  }

  return capas;
}

export const capasPliegue: Faceta[][] = plegar();

export function profundidad(capa: number): number {
  return Number((0.3 + (capa / (CAPAS - 1)) * 0.95).toFixed(2));
}
