/**
 * Posicionamiento del servidor, en un solo lugar.
 *
 * Ojo: `SERVER_INSTRUCTIONS` viaja en el `initialize`, así que el cliente la
 * guarda para toda la sesión. Por eso NO nombra fuentes ni colecciones
 * concretas: si lo hiciera, cada fuente nueva dejaría mintiendo a los clientes
 * ya conectados. Lo que cambia se descubre con `list_collections`.
 */

export const SERVER_TITLE = "Córdoba MCP" as const;

export const SERVER_TAGLINE: string =
  "Una fuente de datos unificada y estandarizada para potenciar la riqueza de los datos " +
  "públicos de Córdoba con la vanguardia en inteligencia artificial.";

export const SERVER_INSTRUCTIONS = `${SERVER_TAGLINE}

Datos públicos de la ciudad y la provincia de Córdoba (Argentina), normalizados a un
modelo común, con la fuente y la fecha del dato declaradas en cada respuesta.

Cuatro tools cubren todo el catálogo, y no cambian cuando se suman datos nuevos:
- \`list_collections\`: qué colecciones hay, qué filtros acepta cada una y qué tan fresca está.
- \`search\`: buscar en una colección por texto, fechas, filtros propios y cercanía a un punto.
- \`get\`: traer registros completos por id.
- \`source_status\`: último run, validación y conteos de cada fuente.

Si no reconocés una colección o un filtro, llamá a \`list_collections\` en vez de adivinar:
los errores de esta API devuelven los valores válidos. Todas las fechas se interpretan y se
devuelven en America/Argentina/Cordoba (UTC-3 todo el año).`;
