#!/usr/bin/env node
import { setDefaultResultOrder } from "node:dns";

// Algunos entornos (WSL2, runners sin IPv6 real) cuelgan al resolver AAAA:
// preferimos IPv4 para que fetch no quede esperando.
setDefaultResultOrder("ipv4first");

import { envelope, SnapshotCache, STATUS_RESOURCE, TOOLS } from "@cordoba/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { z } from "zod";

const dataset = new SnapshotCache({
  url: process.env["AGENDA_DATA_URL"],
  path: process.env["AGENDA_DATA_PATH"],
});

export const server = new McpServer({ name: "cordoba-mcp", version: "0.1.0" });

for (const tool of TOOLS) {
  server.registerTool(
    tool.name,
    { title: tool.title, description: tool.description, inputSchema: tool.inputShape },
    async (args: z.ZodRawShape) => {
      const snapshot = await dataset.get();
      const { data, isError } = tool.handler(snapshot, args);
      const content = [
        { type: "text" as const, text: JSON.stringify(envelope(tool, snapshot, data), null, 1) },
      ];
      return isError ? { content, isError: true } : { content };
    },
  );
}

server.registerResource(
  STATUS_RESOURCE.name,
  STATUS_RESOURCE.uri,
  { title: STATUS_RESOURCE.title, mimeType: STATUS_RESOURCE.mimeType },
  async (uri) => {
    const snapshot = await dataset.get();
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: STATUS_RESOURCE.mimeType,
          text: JSON.stringify(STATUS_RESOURCE.read(snapshot), null, 1),
        },
      ],
    };
  },
);

export async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

await main();
