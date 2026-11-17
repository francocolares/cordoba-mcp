/**
 * Armado del servidor MCP (stdio), separado del binario para que los tests
 * puedan instanciarlo y conectarlo a un transport en memoria.
 *
 * Los tools salen de `TOOLS` (@cordoba/core), los mismos que sirve el Worker.
 * Acá además se expone el punto único para cambiarlos en caliente: `refreshTools`
 * / `setToolEnabled`, que avisan a los clientes ya conectados con
 * `notifications/tools/list_changed`.
 */
import type { LoadedSnapshot } from "@cordoba/core";
import {
  type DatasetOptions,
  envelope,
  SERVER_INFO,
  SnapshotCache,
  STATUS_RESOURCE,
  TOOLS,
} from "@cordoba/core";
import { McpServer, type RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";

/** Tools que sólo tienen sentido si el dataset de farmacias está cargado. */
const FARMACIAS_TOOL_NAMES = TOOLS.filter((t) => t.dataset === "farmacias").map((t) => t.name);

/**
 * Con esto en "1", los tools de farmacias se ocultan cuando el dataset no está
 * disponible (y reaparecen cuando vuelve), emitiendo la notificación. Apagado por
 * defecto: el comportamiento histórico es que el tool exista siempre y devuelva
 * un error explicando que la fuente no está cargada.
 */
const HIDE_UNAVAILABLE_ENV = "CORDOBA_MCP_HIDE_UNAVAILABLE_TOOLS";

export interface CordobaMcpServerOptions {
  dataset?: DatasetOptions;
  /** Inyectable para los tests; por defecto usa la env var. */
  hideUnavailableTools?: boolean;
}

export interface CordobaMcpServer {
  server: McpServer;
  dataset: SnapshotCache;
  /** Todos los tools registrados, habilitados o no. */
  toolNames(): string[];
  /** Sólo los que hoy aparecen en `tools/list`. */
  enabledToolNames(): string[];
  /**
   * Habilita o deshabilita un tool y avisa a los clientes conectados. El SDK
   * emite `notifications/tools/list_changed` solo en `enable()`/`disable()`.
   * Devuelve `false` si el tool no existe o si ya estaba en ese estado.
   */
  setToolEnabled(name: string, enabled: boolean): boolean;
  /**
   * Avisa a los clientes conectados que la lista de tools cambió, sin tocar el
   * set. Útil cuando se modifica un tool por fuera de enable/disable (p. ej. con
   * `update()`) o después de varios cambios seguidos.
   */
  refreshTools(): void;
  /**
   * Único consumidor real del helper: ajusta el set de tools al estado de las
   * fuentes de datos (el dataset de farmacias puede faltar o aparecer entre
   * recargas del `SnapshotCache`). No hace nada si `hideUnavailableTools` está
   * apagado.
   */
  syncToolsWithSnapshot(snapshot: LoadedSnapshot): void;
}

export function createCordobaMcpServer(options: CordobaMcpServerOptions = {}): CordobaMcpServer {
  const dataset = new SnapshotCache(
    options.dataset ?? {
      url: process.env["AGENDA_DATA_URL"],
      path: process.env["AGENDA_DATA_PATH"],
    },
  );

  const hideUnavailable = options.hideUnavailableTools ?? process.env[HIDE_UNAVAILABLE_ENV] === "1";

  const server = new McpServer(SERVER_INFO, {
    // El SDK ya las declara al registrar el primer tool/resource; explícito acá
    // para que el contrato del initialize se lea en un solo lugar.
    capabilities: {
      tools: { listChanged: true },
      resources: { listChanged: true },
    },
  });

  const registered = new Map<string, RegisteredTool>();

  const handle: CordobaMcpServer = {
    server,
    dataset,
    toolNames: () => [...registered.keys()],
    enabledToolNames: () =>
      [...registered.entries()].filter(([, tool]) => tool.enabled).map(([name]) => name),
    setToolEnabled(name, enabled) {
      const tool = registered.get(name);
      if (!tool || tool.enabled === enabled) return false;
      // enable()/disable() del SDK ya disparan la notificación a la sesión activa.
      if (enabled) tool.enable();
      else tool.disable();
      return true;
    },
    refreshTools() {
      server.sendToolListChanged();
    },
    syncToolsWithSnapshot(snapshot) {
      if (!hideUnavailable) return;
      const available = snapshot.farmacias !== null;
      for (const name of FARMACIAS_TOOL_NAMES) handle.setToolEnabled(name, available);
    },
  };

  const getSnapshot = async (): Promise<LoadedSnapshot> => {
    const snapshot = await dataset.get();
    handle.syncToolsWithSnapshot(snapshot);
    return snapshot;
  };

  for (const tool of TOOLS) {
    registered.set(
      tool.name,
      server.registerTool(
        tool.name,
        { title: tool.title, description: tool.description, inputSchema: tool.inputShape },
        async (args: z.ZodRawShape) => {
          const snapshot = await getSnapshot();
          const { data, isError } = tool.handler(snapshot, args);
          const content = [
            {
              type: "text" as const,
              text: JSON.stringify(envelope(tool, snapshot, data), null, 1),
            },
          ];
          return isError ? { content, isError: true } : { content };
        },
      ),
    );
  }

  server.registerResource(
    STATUS_RESOURCE.name,
    STATUS_RESOURCE.uri,
    { title: STATUS_RESOURCE.title, mimeType: STATUS_RESOURCE.mimeType },
    async (uri) => {
      const snapshot = await getSnapshot();
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

  return handle;
}
