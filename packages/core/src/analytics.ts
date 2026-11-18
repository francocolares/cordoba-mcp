/**
 * Vocabulario de la telemetría. Vive en core porque lo comparten los dos
 * extremos: la landing emite los nombres de evento y el Worker los valida
 * antes de escribirlos, así que la lista no puede estar duplicada.
 *
 * Qué se mide y qué no: se cuentan eventos agregados (una visita, un click en
 * "copiar", un `tools/call`), nunca personas. No hay cookies, no hay id
 * persistente y no se guarda la IP: el único identificador es un hash que
 * rota cada día (ver `visitorId` en el Worker), que sirve para separar
 * "sesiones nuevas" de "recurrentes dentro del día" y nada más.
 */

/** Dataset de Workers Analytics Engine donde caen todos los eventos. */
export const ANALYTICS_DATASET = "cordoba_mcp_uso";

/**
 * Eventos que la landing puede reportar a `POST /api/beacon`. El endpoint es
 * público, así que lo que no esté acá se descarta: el dataset no se ensucia
 * con nombres inventados desde afuera.
 */
export const WEB_EVENTS = [
  /** Una carga de página. Es el denominador del embudo. */
  "visita",
  /** CTA del hero hacia la sección de conexión. */
  "conectar_claude",
  /** Botón de copiar la dirección del servidor: el paso previo a conectarse. */
  "copiar_endpoint",
  /** Instructivo oficial de conectores de Claude. */
  "docs_claude",
  /** Invitación a la comunidad de WhatsApp. */
  "comunidad",
  /** Repo en GitHub. */
  "repo",
  /** Correo de contacto. */
  "contacto",
  /** Botón de copiar el correo de contacto. */
  "copiar_contacto",
  /** Correo para pedir la baja de una fuente de datos. */
  "baja_datos",
] as const;

export type WebEvent = (typeof WEB_EVENTS)[number];

const EXACTOS = new Set<string>(WEB_EVENTS);

/**
 * `via_<id>`: los CTA de las fichas de contribución (`VIAS` en la landing).
 * Es un patrón y no nombres fijos para que sumar una vía nueva no obligue a
 * tocar esta lista y perder el dato en silencio.
 */
const VIA = /^via_[a-z][a-z0-9_-]{0,30}$/;

export function isWebEvent(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return EXACTOS.has(value) || VIA.test(value);
}
