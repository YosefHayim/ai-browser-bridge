import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import type { McpServerOptions, StreamableMcpConnection } from "./mcp-server-types.ts";
import { createMcpProtocolServer } from "./mcp-protocol-server.ts";

/** Inputs for opening a streamable HTTP transport. */
export interface OpenStreamableConnectionParams {
  repoRoot: string;
  options: McpServerOptions;
  connections: Map<string, StreamableMcpConnection>;
}

/** Open a streamable HTTP transport and connect the MCP protocol server. */
export async function openStreamableConnection(params: OpenStreamableConnectionParams): Promise<StreamableMcpConnection> {
  const createdConnection = createStreamableTransport(params);
  await createdConnection.server.connect(createdConnection.transport);
  return createdConnection;
}

function createStreamableTransport(params: OpenStreamableConnectionParams): StreamableMcpConnection {
  let createdConnection: StreamableMcpConnection | null = null;
  const transport = buildStreamableTransport({
    params,
    getConnection: () => createdConnection,
  });
  createdConnection = { server: createMcpProtocolServer(params.repoRoot, params.options), transport };
  attachStreamableCloseHandler({ params, transport });
  return createdConnection;
}

function buildStreamableTransport(input: {
  params: OpenStreamableConnectionParams;
  getConnection: () => StreamableMcpConnection | null;
}): StreamableHTTPServerTransport {
  return new StreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (newSessionId) => {
      const connection = input.getConnection();
      if (connection) input.params.connections.set(newSessionId, connection);
    },
  });
}

function attachStreamableCloseHandler(input: {
  params: OpenStreamableConnectionParams;
  transport: StreamableHTTPServerTransport;
}): void {
  input.transport.onclose = () => {
    const closedSessionId = input.transport.sessionId;
    if (closedSessionId) input.params.connections.delete(closedSessionId);
  };
}
