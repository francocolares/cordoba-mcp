import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// El SDK de MCP no es dependencia de la raíz (vive en apps/worker), así que
// los tests de tests/ no lo resolverían por nombre. Resolvemos la carpeta real
// del build ESM desde el contexto de apps/worker, pasando por el mapa
// de `exports` del paquete: así no hardcodeamos la estructura interna (dist/esm)
// ni el layout de node_modules que arme pnpm.
const requireFromMcp = createRequire(src("./apps/worker/package.json"));
const sdkEsmDir = dirname(
  dirname(requireFromMcp.resolve("@modelcontextprotocol/sdk/client/index.js")),
);

export default defineConfig({
  // Los `exports` de @cordoba/core apuntan a dist/, así que `apps/worker/src`
  // (que importa el paquete por su nombre) no resolvería sin un build previo.
  // Con estos alias los tests corren siempre contra src/, igual que el resto
  // de los test files, y `pnpm test` no depende del orden respecto a `pnpm build`.
  resolve: {
    alias: [
      { find: /^@cordoba\/core\/web$/, replacement: src("./packages/core/src/web.ts") },
      { find: /^@cordoba\/core$/, replacement: src("./packages/core/src/index.ts") },
      {
        find: /^@modelcontextprotocol\/sdk\/(.*)$/,
        replacement: `${join(sdkEsmDir, "$1")}`,
      },
    ],
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
