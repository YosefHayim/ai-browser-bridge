import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { McpConnection, McpServerOptions } from "./mcp-server-types.ts";
import { createMcpProtocolServer } from "./mcp-protocol-server.ts";
import { writeSseProxyFlushPadding } from "./mcp-request-utils.ts";

/** Inputs for handling an SSE MCP connection request. */
interface HandleSseRequestParams {
  req: IncomingMessage;
  res: ServerResponse;
  repoRoot: string;
  options: McpServerOptions;
  connections: Map<string, McpConnection>;
}

/** Accept a new SSE MCP session and connect the protocol server. */
export async function handleSseRequest(params: HandleSseRequestParams): Promise<void> {
  const transport = new SSEServerTransport("/messages", params.res);
  const mcp = createMcpProtocolServer(params.repoRoot, params.options);
  params.connections.set(transport.sessionId, { server: mcp, transport });
  transport.onclose = () => params.connections.delete(transport.sessionId);
  try {
    await mcp.connect(transport);
    writeSseProxyFlushPadding(params.res);
  } catch (error) {
    await closeFailedSseConnection({ ...params, transport, mcp, error });
  }
}

/** Inputs for cleaning up a failed SSE connection. */
interface CloseFailedSseConnectionParams extends HandleSseRequestParams {
  transport: SSEServerTransport;
  mcp: ReturnType<typeof createMcpProtocolServer>;
  error: unknown;
}

/** Remove a failed SSE session and write a 500 when headers are still open. */
async function closeFailedSseConnection(params: CloseFailedSseConnectionParams): Promise<void> {
  params.connections.delete(params.transport.sessionId);
  if (!params.res.headersSent) {
    params.res.writeHead(500).end(params.error instanceof Error ? params.error.message : String(params.error));
  }
}

/** Inputs for routing an SSE POST message to an active session. */
interface HandleSsePostMessageParams {
  req: IncomingMessage;
  res: ServerResponse;
  url: string | undefined;
  connections: Map<string, McpConnection>;
}

/** Forward a POST /messages request to the matching SSE session transport. */
export async function handleSsePostMessage(params: HandleSsePostMessageParams): Promise<void> {
  const sessionId = new URL(params.url ?? "/", "http://localhost").searchParams.get("sessionId");
  const connection = sessionId ? params.connections.get(sessionId) : undefined;
  if (connection) {
    await connection.transport.handlePostMessage(params.req, params.res);
    return;
  }
  params.res.writeHead(503).end("No active SSE connection");
}
