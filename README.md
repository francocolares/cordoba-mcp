# cordoba-mcp — monorepo

Monorepo TypeScript (pnpm workspaces + Turborepo). Sólo scaffolding por ahora.

```
apps/mcp       servidor MCP (stdio)
apps/scraper   CLI de scrapers de datos
apps/web       landing page (Astro)
packages/core  tipos y utilidades compartidas (@cordoba/core)
```

## Uso

```bash
pnpm install
pnpm build          # compila todo
pnpm typecheck
pnpm lint           # biome (lint + format check); pnpm format para arreglar
pnpm --filter @cordoba/web dev
pnpm --filter @cordoba/mcp dev
```

Requiere Node >= 22 y pnpm 11 (`corepack enable`).
