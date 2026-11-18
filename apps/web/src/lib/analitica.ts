/**
 * Eventos de la landing. Se mandan a `POST /api/beacon` del propio Worker
 * (mismo dominio: no hay terceros, no hay cookies, no hay id persistente) y
 * ahí se agregan en Analytics Engine.
 *
 * Lo que interesa medir no es la visita sino el embudo:
 *   visita -> copiar_endpoint -> primer `initialize` del MCP.
 * Los dos primeros pasos salen de acá; el tercero lo registra el Worker.
 *
 * Marcado: cualquier elemento con `data-evento="nombre"` se reporta al hacer
 * click, con un único listener delegado en el documento. Los nombres válidos
 * son los de `WEB_EVENTS` en `@cordoba/core` (el Worker descarta el resto).
 */

const ENDPOINT = "/api/beacon";

/** Respetamos la señal de "no me sigas" del navegador, aunque el dato sea anónimo. */
function optOut(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  return (
    nav.globalPrivacyControl === true ||
    nav.doNotTrack === "1" ||
    nav.msDoNotTrack === "1" ||
    (window as Window & { doNotTrack?: string }).doNotTrack === "1"
  );
}

function enviar(evento: string): void {
  const cuerpo = JSON.stringify({ evento, pagina: location.pathname });
  try {
    // sendBeacon sobrevive a la navegación: es lo que hace medible un click
    // que se lleva la pestaña a otro sitio.
    const blob = new Blob([cuerpo], { type: "application/json" });
    if (navigator.sendBeacon(ENDPOINT, blob)) return;
  } catch {
    // Sin sendBeacon (o bloqueado): cae al fetch de abajo.
  }
  void fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: cuerpo,
    keepalive: true,
  }).catch(() => {});
}

export function iniciarAnalitica(): void {
  if (optOut()) return;

  enviar("visita");

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const evento = target.closest<HTMLElement>("[data-evento]")?.dataset.evento;
    if (evento) enviar(evento);
  });
}
