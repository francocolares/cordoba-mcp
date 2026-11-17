/**
 * MCP sobre streamable HTTP, sin estado: cada POST trae un request JSON-RPC y
 * se responde con un único JSON. No hay registro de sesiones, ni Durable
 * Objects, ni canal server->client.
 *
 * No hay canal server->client a propósito. Antes existía un `GET /mcp` con SSE
 * cuyo único trabajo era emitir `notifications/tools/list_changed`; con la
 * superficie congelada en cuatro tools (`TOOLS` de core) esa notificación no se
 * dispara nunca, porque sumar datos no cambia `tools/list`. Lo que cambia se
 * descubre con `list_collections`, y `catalog_version` viaja en cada respuesta.
 */
import {
  CATALOG_RESOURCE,
  SERVER_INFO as CORE_SERVER_INFO,
  envelope,
  SERVER_INSTRUCTIONS,
  type Snapshot,
  TOOLS,
} from "@cordoba/core/web";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/** Nombre y versión salen de packages/core/package.json (fuente única). */
export const SERVER_INFO = CORE_SERVER_INFO;
export const PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOLS = new Set([PROTOCOL_VERSION, "2025-03-26", "2024-11-05"]);

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const PARSE_ERROR = -32700;

const textContent = (value: unknown) => [{ type: "text", text: JSON.stringify(value, null, 1) }];

function toolList() {
  return TOOLS.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: zodToJsonSchema(z.object(tool.inputShape), { target: "jsonSchema7" }),
  }));
}

function resourceList() {
  return [
    {
      uri: CATALOG_RESOURCE.uri,
      name: CATALOG_RESOURCE.name,
      title: CATALOG_RESOURCE.title,
      mimeType: CATALOG_RESOURCE.mimeType,
    },
  ];
}

/** Sin estado colgado: es un uuid y nada más. */
export function newSessionId(): string {
  return crypto.randomUUID();
}

/** Para saber si hay que emitir el header `Mcp-Session-Id` en la respuesta. */
export function containsInitialize(payload: unknown): boolean {
  const items = Array.isArray(payload) ? payload : [payload];
  return items.some(
    (item) =>
      typeof item === "object" && item !== null && (item as JsonRpcRequest).method === "initialize",
  );
}

function callTool(snapshot: Snapshot, params: Record<string, unknown> | undefined) {
  const name = typeof params?.["name"] === "string" ? (params["name"] as string) : null;
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) {
    throw {
      code: INVALID_PARAMS,
      message: `No existe el tool "${name ?? ""}"`,
      data: { available: TOOLS.map((t) => t.name) },
    } satisfies JsonRpcError;
  }
  const parsed = z.object(tool.inputShape).safeParse(params?.["arguments"] ?? {});
  if (!parsed.success) {
    throw {
      code: INVALID_PARAMS,
      message: `Argumentos inválidos para "${tool.name}"`,
      data: parsed.error.issues,
    } satisfies JsonRpcError;
  }
  const { data, isError, collection } = tool.handler(snapshot, parsed.data);
  return {
    content: textContent(envelope(snapshot, data, collection)),
    ...(isError ? { isError: true } : {}),
  };
}

/** Devuelve el `result` del método, o lanza un JsonRpcError. */
function dispatch(snapshot: Snapshot, request: JsonRpcRequest): unknown {
  switch (request.method) {
    case "initialize": {
      const asked = request.params?.["protocolVersion"];
      const version =
        typeof asked === "string" && SUPPORTED_PROTOCOLS.has(asked) ? asked : PROTOCOL_VERSION;
      return {
        protocolVersion: version,
        // Sin `listChanged`: la superficie está congelada, así que no hay nada
        // que notificar y no mentimos sobre una capacidad que no usamos.
        capabilities: { tools: {}, resources: {} },
        serverInfo: SERVER_INFO,
        instructions: SERVER_INSTRUCTIONS,
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: toolList() };
    case "tools/call":
      return callTool(snapshot, request.params);
    case "resources/list":
      return { resources: resourceList() };
    case "resources/templates/list":
      return { resourceTemplates: [] };
    case "resources/read": {
      const uri = request.params?.["uri"];
      if (uri !== CATALOG_RESOURCE.uri) {
        throw { code: INVALID_PARAMS, message: `Resource desconocido: ${String(uri)}` };
      }
      return {
        contents: [
          {
            uri: CATALOG_RESOURCE.uri,
            mimeType: CATALOG_RESOURCE.mimeType,
            text: JSON.stringify(CATALOG_RESOURCE.read(snapshot), null, 1),
          },
        ],
      };
    }
    case "prompts/list":
      return { prompts: [] };
    default:
      throw {
        code: METHOD_NOT_FOUND,
        message: `Método no soportado: ${request.method ?? "(vacío)"}`,
      } satisfies JsonRpcError;
  }
}

function isJsonRpcError(value: unknown): value is JsonRpcError {
  return typeof value === "object" && value !== null && "code" in value && "message" in value;
}

function handleOne(snapshot: Snapshot, request: JsonRpcRequest): unknown | null {
  const id = request.id ?? null;
  // Las notificaciones (sin id) no llevan respuesta.
  const isNotification = request.id === undefined || request.id === null;
  try {
    if (request.method === undefined) {
      if (isNotification) return null;
      return { jsonrpc: "2.0", id, error: { code: INVALID_REQUEST, message: "Falta `method`" } };
    }
    if (isNotification) {
      // notifications/initialized, notifications/cancelled, etc.: nada que devolver.
      return null;
    }
    return { jsonrpc: "2.0", id, result: dispatch(snapshot, request) };
  } catch (err) {
    const error = isJsonRpcError(err)
      ? err
      : { code: -32603, message: err instanceof Error ? err.message : "Error interno" };
    return { jsonrpc: "2.0", id, error };
  }
}

/** Procesa el body de un POST /mcp. `null` = sólo notificaciones (202 sin cuerpo). */
export function handleMcpPayload(snapshot: Snapshot, payload: unknown): unknown | null {
  if (Array.isArray(payload)) {
    const responses = payload
      .map((item) => handleOne(snapshot, item as JsonRpcRequest))
      .filter((r) => r !== null);
    return responses.length > 0 ? responses : null;
  }
  if (typeof payload !== "object" || payload === null) {
    return { jsonrpc: "2.0", id: null, error: { code: PARSE_ERROR, message: "Body inválido" } };
  }
  return handleOne(snapshot, payload as JsonRpcRequest);
}
