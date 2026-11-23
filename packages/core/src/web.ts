/**
 * Entrypoint sin dependencias de Node: sirve en Cloudflare Workers y en el browser.
 * No exporta nada que toque `node:fs` / `node:crypto` (store, scrape, gviz, normalize).
 */
export const PROJECT = "cordoba-mcp" as const;

export * from "./analytics.js";
export * from "./branding.js";
export * from "./categories.js";
export * from "./collections/index.js";
export * from "./collections.js";
export * from "./config.js";
export * from "./datetime.js";
export * from "./errors.js";
export * from "./exportadores/web.js";
export * from "./farmacias/web.js";
export * from "./ids.js";
export * from "./jsonl.js";
export * from "./models.js";
export * from "./query.js";
export * from "./text.js";
export * from "./tools.js";
export * from "./version.js";
