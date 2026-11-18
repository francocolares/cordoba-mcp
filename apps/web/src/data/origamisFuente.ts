export type PlanoFuente = {
  points: string;
  opacity: number;
  d: number;
};

export const ORIGAMI_FUENTE_VIEWBOX = { width: 100, height: 100 } as const;

export const origamiPorFuente: Record<string, PlanoFuente[]> = {
  agenda: [
    { points: "14,18 86,14 87,33 15,36", opacity: 1, d: 1 },
    { points: "15,36 87,33 88,68 62,86 17,84", opacity: 0.58, d: 0.55 },
    { points: "62,86 88,68 65,66", opacity: 0.88, d: 0.9 },
    { points: "14,18 15,36 17,84 9,80 7,22", opacity: 0.42, d: 0.3 },
  ],
  farmacias: [
    { points: "38,38 62,36 64,62 40,64", opacity: 0.95, d: 0.8 },
    { points: "40,10 60,9 62,36 38,38", opacity: 0.6, d: 1 },
    { points: "40,64 64,62 62,92 42,90", opacity: 0.42, d: 0.35 },
    { points: "10,42 38,38 40,64 12,66", opacity: 0.75, d: 0.65 },
    { points: "64,36 90,40 88,64 64,62", opacity: 0.5, d: 0.5 },
  ],
  satelites: [
    { points: "4,40 40,36 41,56 5,60", opacity: 0.5, d: 1 },
    { points: "60,36 96,40 95,60 59,56", opacity: 0.58, d: 0.75 },
    { points: "42,34 58,32 59,64 43,66", opacity: 1, d: 0.55 },
    { points: "43,66 59,64 55,78 47,79", opacity: 0.66, d: 0.4 },
    { points: "49,78 55,78 54,95 50,95", opacity: 0.34, d: 0.25 },
  ],
  incendios: [
    { points: "36,92 26,56 46,74 42,92", opacity: 0.5, d: 0.9 },
    { points: "60,92 72,54 58,78 66,92", opacity: 0.44, d: 0.8 },
    { points: "50,6 66,48 58,92 40,92 34,50", opacity: 0.78, d: 1 },
    { points: "50,38 59,62 50,86 41,62", opacity: 1, d: 0.5 },
  ],
  agro: [
    { points: "6,54 34,32 58,54", opacity: 0.88, d: 0.95 },
    { points: "44,54 70,40 94,54", opacity: 0.5, d: 0.7 },
    { points: "8,96 28,96 40,56 34,56", opacity: 0.5, d: 0.45 },
    { points: "36,96 60,96 53,56 47,56", opacity: 0.72, d: 0.55 },
    { points: "68,96 92,96 66,56 60,56", opacity: 0.4, d: 0.35 },
  ],
  economia: [
    { points: "12,66 30,62 32,90 14,90", opacity: 0.45, d: 0.3 },
    { points: "36,50 54,46 56,90 38,90", opacity: 0.66, d: 0.55 },
    { points: "60,34 78,28 80,90 62,90", opacity: 0.88, d: 0.8 },
    { points: "70,31 96,8 94,34", opacity: 1, d: 1 },
  ],
  exportadores: [
    { points: "20,30 50,18 80,30 50,42", opacity: 1, d: 0.9 },
    { points: "20,30 50,42 50,82 20,66", opacity: 0.55, d: 0.5 },
    { points: "50,42 80,30 80,66 50,82", opacity: 0.72, d: 0.65 },
    { points: "20,30 50,18 44,6 13,19", opacity: 0.36, d: 1 },
  ],
  catastro: [
    { points: "50,12 86,30 50,48 14,30", opacity: 1, d: 1 },
    { points: "50,38 86,56 50,74 14,56", opacity: 0.6, d: 0.6 },
    { points: "50,64 86,82 50,100 14,82", opacity: 0.4, d: 0.28 },
  ],
  colectivos: [
    { points: "12,30 86,24 88,36 14,40", opacity: 1, d: 0.9 },
    { points: "14,40 88,36 86,56 16,58", opacity: 0.5, d: 0.65 },
    { points: "16,58 86,56 84,76 18,78", opacity: 0.74, d: 0.45 },
    { points: "26,78 38,78 36,89 28,89", opacity: 0.34, d: 0.2 },
    { points: "64,76 76,76 74,87 66,87", opacity: 0.34, d: 0.2 },
  ],
  cultura: [
    { points: "50,8 92,32 8,32", opacity: 1, d: 1 },
    { points: "8,32 92,32 90,43 10,43", opacity: 0.62, d: 0.7 },
    { points: "18,43 30,43 32,84 20,84", opacity: 0.76, d: 0.5 },
    { points: "44,43 56,43 57,84 45,84", opacity: 0.48, d: 0.4 },
    { points: "70,43 82,43 83,84 71,84", opacity: 0.66, d: 0.55 },
    { points: "10,84 86,84 88,93 8,93", opacity: 0.38, d: 0.22 },
  ],
  festivales: [
    { points: "50,14 94,80 50,62", opacity: 0.52, d: 0.7 },
    { points: "50,14 50,62 6,80", opacity: 0.84, d: 1 },
    { points: "6,80 50,62 94,80 50,94", opacity: 0.36, d: 0.3 },
    { points: "50,8 72,15 50,22", opacity: 1, d: 1 },
  ],
  cine: [
    { points: "12,28 32,26 29,45 13,46", opacity: 1, d: 1 },
    { points: "32,26 52,24 49,43 29,45", opacity: 0.5, d: 0.9 },
    { points: "52,24 72,22 69,41 49,43", opacity: 0.94, d: 0.8 },
    { points: "72,22 90,20 88,39 69,41", opacity: 0.46, d: 0.7 },
    { points: "13,46 88,39 90,84 15,90", opacity: 0.62, d: 0.45 },
    { points: "15,90 90,84 88,94 17,98", opacity: 0.32, d: 0.25 },
  ],
  tramites: [
    { points: "22,12 70,10 80,25 78,88 24,90", opacity: 0.84, d: 0.6 },
    { points: "70,10 80,25 65,27", opacity: 1, d: 1 },
    { points: "32,38 68,36 68,47 32,49", opacity: 0.5, d: 0.85 },
    { points: "32,57 60,55 60,66 32,68", opacity: 0.36, d: 0.7 },
  ],
};
