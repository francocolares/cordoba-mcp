/**
 * Entrypoint sin dependencias de Node: sirve en Cloudflare Workers y en el browser.
 * No exporta nada que toque `node:fs` / `node:crypto` (store, scrape, gviz, normalize).
 */
export const PROJECT = "cordoba-mcp" as const;

export * from "./categories.js";
export * from "./config.js";
export * from "./datetime.js";
export * from "./models.js";
export * from "./query.js";
export * from "./text.js";
export * from "./tools.js";
