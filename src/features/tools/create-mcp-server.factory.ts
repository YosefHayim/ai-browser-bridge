import { createServer } from "node:http";
import type { McpConnection, McpServerHandle, McpServerOptions, StreamableMcpConnection } from "./mcp-server-types.ts";
import { bindMcpRoutes } from "./create-mcp-server.route.ts";

/** Inputs for starting the MCP HTTP server. */
export interface StartMcpServerParams {
  repoRoot: string;
  port: number;
  options?: McpServerOptions;
}

/**
 * Start the MCP server with SSE and streamable HTTP transports.
 *
 * Registers all tools from the tool registry and listens for
 * incoming connections from ChatGPT via the Cloudflare tunnel.
 */
export function startMcpServer(
  repoRoot: string,
  port: number,
  options: McpServerOptions = {},
): Promise<McpServerHandle> {
  return startMcpServerFromParams({ repoRoot, port, options });
}

/** Start the MCP server from a single params object. */
function startMcpServerFromParams(params: StartMcpServerParams): Promise<McpServerHandle> {
  return listenMcpServer(createMcpHttpServer(params));
}

function createMcpHttpServer(params: StartMcpServerParams): ListenMcpServerParams {
  const httpServer = createServer();
  const connections = new Map<string, McpConnection>();
  const streamableConnections = new Map<string, StreamableMcpConnection>();
  bindMcpRoutes({ httpServer, routeParams: { ...params, connections, streamableConnections } });
  return { httpServer, port: params.port, connections, streamableConnections };
}

/** Inputs for binding the MCP HTTP server to a port. */
interface ListenMcpServerParams {
  httpServer: ReturnType<typeof createServer>;
  port: number;
  connections: Map<string, McpConnection>;
  streamableConnections: Map<string, StreamableMcpConnection>;
}

/** Bind the HTTP server and return a handle with a close function. */
function listenMcpServer(params: ListenMcpServerParams): Promise<McpServerHandle> {
  return listenHttpPort(params).then(() => buildMcpServerHandle(params));
}

async function listenHttpPort(params: ListenMcpServerParams): Promise<void> {
  const listenError = await new Promise<Error | undefined>((done) => {
    const onError = (err: Error) => done(err);
    params.httpServer.once("error", onError);
    params.httpServer.listen(params.port, () => {
      params.httpServer.off("error", onError);
      done(undefined);
    });
  });
  if (listenError) throw listenError;
}

/** Build the public MCP server handle from active connection maps. */
function buildMcpServerHandle(params: ListenMcpServerParams): McpServerHandle {
  return { url: `http://localhost:${params.port}`, close: () => closeMcpServer(params) };
}

/** Close all MCP connections and shut down the HTTP server. */
function closeMcpServer(params: ListenMcpServerParams): void {
  closeAllConnections(params.connections);
  closeAllConnections(params.streamableConnections);
  params.httpServer.close();
}

/** Close every MCP protocol server in a connection map. */
function closeAllConnections(connections: Map<string, McpConnection | StreamableMcpConnection>): void {
  for (const connection of connections.values()) connection.server.close().catch(() => {});
  connections.clear();
}
