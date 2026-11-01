import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "cordoba-mcp", version: "0.0.0" });

// TODO: registrar tools/resources.

await server.connect(new StdioServerTransport());
