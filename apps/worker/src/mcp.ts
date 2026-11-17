/**
 * MCP sobre streamable HTTP. Cada POST trae un request JSON-RPC y se responde
 * con un único JSON; el canal server->client es el `GET /mcp` con SSE (ver
 * sse.ts), que sirve para avisar `notifications/tools/list_changed`.
 *
 * Sigue sin estado compartido: no hay registro de sesiones ni Durable Objects.
 * El truco es que el `Mcp-Session-Id` lleva adentro la revisión de tools con la
 * que el cliente hizo el handshake, así que cada isolate puede decidir solo si
 * ese cliente está viendo una lista vieja. Las tools son las mismas que usa el
 * servidor stdio: `TOOLS` de core.
 */
import {
  SERVER_INFO as CORE_SERVER_INFO,
  envelope,
  type Snapshot,
  STATUS_RESOURCE,
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
      uri: STATUS_RESOURCE.uri,
      name: STATUS_RESOURCE.name,
      title: STATUS_RESOURCE.title,
      mimeType: STATUS_RESOURCE.mimeType,
    },
  ];
}

/** djb2. No es criptográfico: sólo detecta cambios, no protege nada. */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Huella de lo que el cliente ve en `tools/list` y `resources/list`. Es el
 * disparador de la notificación: cambia cuando se agrega, saca o edita un tool
 * (nombre, título, descripción o schema), y NO cambia en los deploys que sólo
 * traen datos nuevos, que son la mayoría (el cron diario). Así los clientes no
 * re-listan todos los días al vacío.
 */
export const TOOLS_REVISION: string = hash(
  JSON.stringify({ tools: toolList(), resources: resourceList() }),
);

const SESSION_SEPARATOR = "~";

/**
 * `<revisión>~<uuid>`. Sin firmar a propósito: lo único que el server deduce de
 * acá es si le manda una notificación o no, así que falsificarlo sólo consigue
 * que te notifiquen de más. No hay autorización ni estado colgado de la sesión.
 */
export function newSessionId(): string {
  return `${TOOLS_REVISION}${SESSION_SEPARATOR}${crypto.randomUUID()}`;
}

/** La revisión con la que se abrió esa sesión, o null si no se puede leer. */
export function revisionOf(sessionId: string | null | undefined): string | null {
  if (!sessionId) return null;
  const [revision] = sessionId.split(SESSION_SEPARATOR);
  return revision ? revision : null;
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
  return {
    content: textContent(envelope(tool, snapshot, data)),
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
        // Las notificaciones salen por el GET con SSE (sse.ts). Ver README,
        // "Política de cambios en tools".
        capabilities: { tools: { listChanged: true }, resources: { listChanged: true } },
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
      return { resources: resourceList() };
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
