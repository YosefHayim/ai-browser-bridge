import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { McpConnection, McpServerOptions, StreamableMcpConnection } from "./mcp-server-types.ts";
import { routeMcpRequest } from "./mcp-http-router.ts";

/** Inputs for binding MCP HTTP request routing. */
export interface BindMcpRoutesInput {
  httpServer: ReturnType<typeof createServer>;
  routeParams: {
    repoRoot: string;
    port: number;
    options?: McpServerOptions;
    connections: Map<string, McpConnection>;
    streamableConnections: Map<string, StreamableMcpConnection>;
  };
}

/** Attach the MCP HTTP router to a Node HTTP server. */
export function bindMcpRoutes(input: BindMcpRoutesInput): void {
  input.httpServer.on("request", (...eventArgs) => routeIncomingRequest({ eventArgs, routeParams: input.routeParams }));
}

function routeIncomingRequest(input: {
  eventArgs: unknown[];
  routeParams: BindMcpRoutesInput["routeParams"];
}): void {
  const req = input.eventArgs[0] as IncomingMessage;
  const res = input.eventArgs[1] as ServerResponse;
  void routeMcpRequest({ req, res, ...input.routeParams });
}
