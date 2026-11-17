/**
 * Selección y formato de las farmacias de turno que muestra la demo.
 *
 * Corre en los dos lados: en el build (con el dataset del repo) y en el
 * navegador (con /api/farmacias_turno.jsonl). Igual que demoEventos, no importa nada
 * de @cordoba/core para no arrastrar zod al bundle del cliente.
 */
import type { ItemChat } from "./demoEventos";
import { TZ_CBA } from "./demoEventos";

export type FarmaciaCruda = {
  turno: number;
  section: number | null;
  name: string | null;
  address: string | null;
  barrio: string | null;
  raw: string;
  active: boolean;
};

export type CalendarioCrudo = {
  year: number;
  days: Record<string, number>;
};

/** Barrios que un visitante ubica sin pensar: la demo prefiere estos. */
const BARRIOS_CENTRICOS = ["centro", "nueva cordoba", "general paz", "guemes", "alberdi"];

const sinTildes = (valor: string) =>
  valor
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

const fechaCordoba = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: TZ_CBA,
});

const relojCordoba = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: TZ_CBA,
});

/** La hora de Córdoba como decimal: 8.5 son las 08:30. */
export function horaCordoba(ahora: Date): number {
  const partes = relojCordoba.formatToParts(ahora);
  const valor = (tipo: string) => Number(partes.find((parte) => parte.type === tipo)?.value ?? "0");
  return valor("hour") + valor("minute") / 60;
}

/**
 * El día de guardia en Córdoba. La guardia arranca a `inicioHora`, así que
 * antes de esa hora sigue de turno la farmacia del día anterior.
 */
export function diaDeGuardia(ahora: Date = new Date(), inicioHora = 8.5): string {
  const hora = horaCordoba(ahora);
  const hoy = fechaCordoba.format(ahora);
  if (hora >= inicioHora) return hoy;
  const ayer = new Date(ahora.getTime() - 86_400_000);
  return fechaCordoba.format(ayer);
}

/** Turno del día, sólo si está en un turnero cargado (no lo proyectamos acá). */
export function turnoExacto(calendarios: CalendarioCrudo[], dia: string): number | null {
  for (const calendario of calendarios) {
    const turno = calendario.days[dia];
    if (turno !== undefined) return turno;
  }
  return null;
}

export function formatearFarmacia(f: FarmaciaCruda): ItemChat {
  const partes = [f.address, f.barrio ? `Bº ${f.barrio}` : null].filter(Boolean);
  return {
    titulo: f.name ?? f.raw,
    meta: partes.length > 0 ? partes.join(" · ") : f.raw,
    etiqueta: null,
  };
}

export type GuardiaDemo = {
  dia: string;
  turno: number | null;
  items: ItemChat[];
};

/**
 * Dos farmacias de la guardia de hoy, preferentemente de barrios céntricos.
 * Si no hay turnero para hoy, `turno` es null y la demo vuelve a rotularse
 * como ejemplo: preferimos no afirmar una guardia que no podemos sostener.
 */
export function elegirGuardia(
  farmacias: FarmaciaCruda[],
  calendarios: CalendarioCrudo[],
  ahora: Date = new Date(),
): GuardiaDemo {
  const dia = diaDeGuardia(ahora);
  const turno = turnoExacto(calendarios, dia);
  if (turno === null) return { dia, turno: null, items: [] };

  const delTurno = farmacias.filter((f) => f.active && f.turno === turno);
  const centricas = delTurno.filter((f) =>
    BARRIOS_CENTRICOS.some((barrio) =>
      sinTildes(`${f.barrio ?? ""} ${f.address ?? ""}`).includes(barrio),
    ),
  );
  const elegibles = centricas.length >= 2 ? centricas : delTurno;
  return { dia, turno, items: elegibles.slice(0, 2).map(formatearFarmacia) };
}

/** Parsea el NDJSON de /api/farmacias_turno.jsonl, salteando líneas rotas. */
export function parsearFarmacias(texto: string): FarmaciaCruda[] {
  const farmacias: FarmaciaCruda[] = [];
  for (const linea of texto.split("\n")) {
    const limpia = linea.trim();
    if (!limpia) continue;
    try {
      farmacias.push(JSON.parse(limpia) as FarmaciaCruda);
    } catch {
      // Una línea corrupta no debería tirar abajo la demo entera.
    }
  }
  return farmacias;
}
