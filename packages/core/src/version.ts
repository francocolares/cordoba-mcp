/**
 * Fuente única de verdad de la versión del servidor MCP.
 *
 * Sale de `packages/core/package.json`, el único lugar donde se bumpea: tanto el
 * servidor stdio (apps/mcp) como el Worker (apps/worker) la reportan en
 * `serverInfo.version`. El import se resuelve relativo al archivo emitido, y
 * `src/` y `dist/` están ambos a un nivel de la raíz del paquete, así que
 * `../package.json` apunta al mismo archivo en dev (tsx/vitest) y en build (tsc,
 * esbuild/wrangler).
 */
import pkg from "../package.json" with { type: "json" };

export const SERVER_NAME = "cordoba-mcp" as const;

export const SERVER_VERSION: string = pkg.version;

/** Lo que va en `serverInfo` del `initialize`. */
export const SERVER_INFO: { name: string; version: string } = {
  name: SERVER_NAME,
  version: SERVER_VERSION,
};
