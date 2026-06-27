import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { McpServerOptions, StreamableMcpConnection } from "./mcp-server-types.ts";
import { readJsonBody, requestHeader, writeJsonRpcError } from "./mcp-request-utils.ts";
import { openStreamableConnection } from "./mcp-streamable-open.ts";

/** Inputs for handling a streamable HTTP MCP request. */
interface HandleStreamableHttpRequestParams {
  req: IncomingMessage;
  res: ServerResponse;
  repoRoot: string;
  options: McpServerOptions;
  connections: Map<string, StreamableMcpConnection>;
}

/** Route a streamable HTTP MCP request to an existing or new session. */
export async function handleStreamableHttpRequest(params: HandleStreamableHttpRequestParams): Promise<void> {
  const sessionId = requestHeader(params.req.headers["mcp-session-id"]);
  let connection = sessionId ? params.connections.get(sessionId) : undefined;
  let parsedBody: unknown;
  if (!connection) {
    const created = await createStreamableConnection(params);
    if (!created) return;
    connection = created.connection;
    parsedBody = created.parsedBody;
  }
  await dispatchStreamableRequest({ connection, req: params.req, res: params.res, parsedBody });
}

/** Result of creating a new streamable HTTP MCP session. */
interface CreatedStreamableConnection {
  connection: StreamableMcpConnection;
  parsedBody: unknown;
}

/** Create a new streamable HTTP session when no session id is provided. */
async function createStreamableConnection(
  params: HandleStreamableHttpRequestParams,
): Promise<CreatedStreamableConnection | null> {
  if (rejectInvalidStreamableSession(params)) return null;
  const parsedBody = await readJsonBody(params.req);
  if (!isInitializeRequest(parsedBody)) {
    writeJsonRpcError(params.res, 400, "Bad Request: No valid session ID provided");
    return null;
  }
  const connection = await openStreamableConnection(params);
  return { connection, parsedBody };
}

function rejectInvalidStreamableSession(params: HandleStreamableHttpRequestParams): boolean {
  const sessionId = requestHeader(params.req.headers["mcp-session-id"]);
  if (sessionId) {
    writeJsonRpcError(params.res, 404, "Session not found");
    return true;
  }
  if (params.req.method !== "POST") {
    writeJsonRpcError(params.res, 400, "Bad Request: No valid session ID provided");
    return true;
  }
  return false;
}

/** Inputs for dispatching a request to an active streamable session. */
interface DispatchStreamableRequestParams {
  connection: StreamableMcpConnection;
  req: IncomingMessage;
  res: ServerResponse;
  parsedBody: unknown;
}

/** Forward the HTTP request to the streamable transport (with error fallback). */
async function dispatchStreamableRequest(params: DispatchStreamableRequestParams): Promise<void> {
  try {
    await params.connection.transport.handleRequest(params.req, params.res, params.parsedBody);
  } catch (error) {
    if (!params.res.headersSent) {
      writeJsonRpcError(params.res, 500, error instanceof Error ? error.message : "Internal server error");
    }
  }
}
