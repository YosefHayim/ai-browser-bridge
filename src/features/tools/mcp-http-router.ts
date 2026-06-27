import type { IncomingMessage, ServerResponse } from "node:http";
import type { McpConnection, McpServerOptions, StreamableMcpConnection } from "./mcp-server-types.ts";
import { isSseEndpointPath, isStreamableHttpEndpointPath } from "./mcp-endpoint-paths.ts";
import { requestPathname } from "./mcp-request-utils.ts";
import { handleSsePostMessage, handleSseRequest } from "./mcp-sse-handler.ts";
import { handleStreamableHttpRequest } from "./mcp-streamable-handler.ts";

/** Inputs for routing one HTTP request to the correct MCP transport. */
export interface RouteMcpRequestParams {
  req: IncomingMessage;
  res: ServerResponse;
  repoRoot: string;
  options?: McpServerOptions;
  connections: Map<string, McpConnection>;
  streamableConnections: Map<string, StreamableMcpConnection>;
}

/** Route an HTTP request to streamable HTTP, SSE, or POST /messages handlers. */
export async function routeMcpRequest(params: RouteMcpRequestParams): Promise<void> {
  const pathname = requestPathname(params.req.url);
  if (isStreamableHttpEndpointPath(pathname)) {
    await routeStreamableRequest(params);
    return;
  }
  if (isSseEndpointPath(pathname)) {
    await routeSseRequest(params);
    return;
  }
  if (pathname === "/messages" && params.req.method === "POST") {
    await routeSsePostMessage(params);
    return;
  }
  params.res.writeHead(404).end("Not found");
}

/** Forward to the streamable HTTP handler. */
async function routeStreamableRequest(params: RouteMcpRequestParams): Promise<void> {
  await handleStreamableHttpRequest({
    req: params.req,
    res: params.res,
    repoRoot: params.repoRoot,
    options: params.options ?? {},
    connections: params.streamableConnections,
  });
}

/** Forward to the SSE connection handler. */
async function routeSseRequest(params: RouteMcpRequestParams): Promise<void> {
  await handleSseRequest({
    req: params.req,
    res: params.res,
    repoRoot: params.repoRoot,
    options: params.options ?? {},
    connections: params.connections,
  });
}

/** Forward to the SSE POST /messages handler. */
async function routeSsePostMessage(params: RouteMcpRequestParams): Promise<void> {
  await handleSsePostMessage({
    req: params.req,
    res: params.res,
    url: params.req.url,
    connections: params.connections,
  });
}
