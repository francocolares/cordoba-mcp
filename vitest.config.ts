import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  // Los `exports` de @cordoba/core apuntan a dist/, así que `apps/worker/src`
  // (que importa el paquete por su nombre) no resolvería sin un build previo.
  // Con estos alias los tests corren siempre contra src/, igual que el resto
  // de los test files, y `pnpm test` no depende del orden respecto a `pnpm build`.
  resolve: {
    alias: [
      { find: /^@cordoba\/core\/web$/, replacement: src("./packages/core/src/web.ts") },
      { find: /^@cordoba\/core$/, replacement: src("./packages/core/src/index.ts") },
    ],
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
