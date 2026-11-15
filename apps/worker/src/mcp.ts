/**
 * MCP sobre streamable HTTP, sin estado: cada POST trae un request JSON-RPC y se
 * responde con un único JSON (la spec lo permite y evita necesitar SSE/Durable
 * Objects). Las tools son las mismas que usa el servidor stdio: `TOOLS` de core.
 */
import { type AgendaSnapshot, envelope, STATUS_RESOURCE, TOOLS } from "@cordoba/core/web";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const SERVER_INFO = { name: "cordoba-mcp", version: "0.1.0" } as const;
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

function callTool(snapshot: AgendaSnapshot, params: Record<string, unknown> | undefined) {
  const name = typeof params?.["name"] === "string" ? (params["name"] as string) : null;
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) {
    throw {
      code: INVALID_PARAMS,
      message: `No existe el tool "${name ?? ""}"`,
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
  const { data, isError } = tool.handler(snapshot, parsed.data);
  return { content: textContent(envelope(snapshot, data)), ...(isError ? { isError: true } : {}) };
}

/** Devuelve el `result` del método, o lanza un JsonRpcError. */
function dispatch(snapshot: AgendaSnapshot, request: JsonRpcRequest): unknown {
  switch (request.method) {
    case "initialize": {
      const asked = request.params?.["protocolVersion"];
      const version =
        typeof asked === "string" && SUPPORTED_PROTOCOLS.has(asked) ? asked : PROTOCOL_VERSION;
      return {
        protocolVersion: version,
        capabilities: { tools: {}, resources: {} },
        serverInfo: SERVER_INFO,
        instructions:
          "Agenda de eventos de la ciudad de Córdoba (Argentina). Las fechas se interpretan en America/Argentina/Cordoba.",
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: toolList() };
    case "tools/call":
      return callTool(snapshot, request.params);
    case "resources/list":
      return {
        resources: [
          {
            uri: STATUS_RESOURCE.uri,
            name: STATUS_RESOURCE.name,
            title: STATUS_RESOURCE.title,
            mimeType: STATUS_RESOURCE.mimeType,
          },
        ],
      };
    case "resources/templates/list":
      return { resourceTemplates: [] };
    case "resources/read": {
      const uri = request.params?.["uri"];
      if (uri !== STATUS_RESOURCE.uri) {
        throw { code: INVALID_PARAMS, message: `Resource desconocido: ${String(uri)}` };
      }
      return {
        contents: [
          {
            uri: STATUS_RESOURCE.uri,
            mimeType: STATUS_RESOURCE.mimeType,
            text: JSON.stringify(STATUS_RESOURCE.read(snapshot), null, 1),
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

function handleOne(snapshot: AgendaSnapshot, request: JsonRpcRequest): unknown | null {
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
export function handleMcpPayload(snapshot: AgendaSnapshot, payload: unknown): unknown | null {
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
