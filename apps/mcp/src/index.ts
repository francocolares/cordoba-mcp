#!/usr/bin/env node
import { setDefaultResultOrder } from "node:dns";

// Algunos entornos (WSL2, runners sin IPv6 real) cuelgan al resolver AAAA:
// preferimos IPv4 para que fetch no quede esperando.
setDefaultResultOrder("ipv4first");

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createCordobaMcpServer } from "./server.js";

const mcp = createCordobaMcpServer();

/** Se mantiene exportado por compatibilidad con lo que ya lo importaba. */
export const server = mcp.server;
export { mcp };

export async function main(): Promise<void> {
  await mcp.server.connect(new StdioServerTransport());
}

await main();
