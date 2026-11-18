import type { APIRoute } from "astro";
import { ISOTIPO_VIEWBOX, planosIsotipoMono } from "../data/isotipo";

/**
 * El favicon se genera del mismo isotipo que la marca del header y del pie
 * (`planosIsotipoMono`), no de un archivo aparte: si el pliegue cambia, el
 * favicon cambia con él en el próximo build.
 *
 * Diferencias con `CordobaMark`, pensadas para los 16 px de una pestaña:
 *  - Va sobre el cuadrado oscuro de la marca, porque la pestaña puede estar en
 *    claro y un pliegue blanco suelto ahí no se vería.
 *  - Sin el filete de los pliegues: a esa escala mide menos de un décimo de
 *    píxel y sólo ensucia el dibujo.
 */

/** Lienzo cuadrado, en las mismas unidades en las que se escriben los planos. */
const LIENZO = 32;
/** Aire entre el pliegue y el borde del cuadrado. */
const MARGEN = 3;

const TINTA = "#f9f8f6"; // ivory
const FONDO = "#0a0a0a"; // jet, el mismo del `theme-color` de la página

/** El isotipo es alto y angosto: lo que manda la escala es su altura. */
const escala = (LIENZO - MARGEN * 2) / ISOTIPO_VIEWBOX.height;
const ancho = ISOTIPO_VIEWBOX.width * escala;
const x = (LIENZO - ancho) / 2;

const planos = planosIsotipoMono
  .map((p) => `<polygon points="${p.points}" opacity="${p.opacity}" />`)
  .join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LIENZO} ${LIENZO}">
  <rect width="${LIENZO}" height="${LIENZO}" rx="7" fill="${FONDO}" />
  <g transform="translate(${x.toFixed(3)} ${MARGEN}) scale(${escala.toFixed(4)})" fill="${TINTA}">${planos}</g>
</svg>
`;

export const GET: APIRoute = () =>
  new Response(svg, {
    headers: {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=86400",
    },
  });
