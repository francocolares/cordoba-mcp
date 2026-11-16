/**
 * Selección y formato de los eventos que muestra la demo.
 *
 * Corre en los dos lados: en el build (con el dataset del repo) y en el
 * navegador (con lo que devuelve /api/events.jsonl). Por eso no importa nada
 * de @cordoba/core: el barrel arrastraría zod y compañía al bundle del cliente.
 */

/** La zona de Córdoba. `index.astro` verifica contra el TZ de core en el build. */
export const TZ_CBA = "America/Argentina/Cordoba";

/** Lo que muestra la demo: cosas para salir, nada institucional. */
export const CATEGORIAS_DEMO = ["musica", "humor", "fiesta", "teatro", "danza", "feria"];

/** Lo mínimo que la demo necesita de un evento. */
export type EventoCrudo = {
  title: string;
  start: string;
  venue: string | null;
  category: string;
  price_type: string;
  all_day: boolean;
  is_permanent: boolean;
  active: boolean;
};

export type ItemChat = {
  titulo: string;
  meta: string;
  etiqueta: string | null;
};

const fechaConHora = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TZ_CBA,
});

const fechaSola = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: TZ_CBA,
});

/** Viernes, sábado o domingo. */
const esFinde = (iso: string) => {
  const dia = new Date(iso).getDay();
  return dia === 5 || dia === 6 || dia === 0;
};

/**
 * Dos eventos para la demo: próximos, para salir, del fin de semana si los
 * hay, y de días distintos para que no caigan los dos en la misma noche.
 */
export function elegirEventos(eventos: EventoCrudo[], ahora = Date.now()): EventoCrudo[] {
  const candidatos = eventos
    .filter((e) => e.active && !e.is_permanent && Date.parse(e.start) >= ahora)
    .filter((e) => CATEGORIAS_DEMO.includes(e.category))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

  const delFinde = candidatos.filter((e) => esFinde(e.start));
  const elegibles = delFinde.length >= 2 ? delFinde : candidatos;

  const porDia = new Map<string, EventoCrudo>();
  for (const e of elegibles) {
    const dia = e.start.slice(0, 10);
    if (!porDia.has(dia)) porDia.set(dia, e);
  }

  const unoPorDia = [...porDia.values()].slice(0, 2);
  return unoPorDia.length === 2 ? unoPorDia : elegibles.slice(0, 2);
}

export function formatearEvento(e: EventoCrudo): ItemChat {
  const cuando = e.all_day
    ? fechaSola.format(new Date(e.start))
    : fechaConHora.format(new Date(e.start));

  return {
    titulo: e.title,
    meta: e.venue ? `${cuando} · ${e.venue}` : cuando,
    etiqueta: e.price_type === "gratis" ? "gratis" : null,
  };
}

/** Parsea el NDJSON de /api/events.jsonl, salteando líneas rotas. */
export function parsearJsonl(texto: string): EventoCrudo[] {
  const eventos: EventoCrudo[] = [];
  for (const linea of texto.split("\n")) {
    const limpia = linea.trim();
    if (!limpia) continue;
    try {
      eventos.push(JSON.parse(limpia) as EventoCrudo);
    } catch {
      // Una línea corrupta no debería tirar abajo la demo entera.
    }
  }
  return eventos;
}
