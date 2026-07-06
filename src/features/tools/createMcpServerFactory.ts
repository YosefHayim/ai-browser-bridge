import { McpServer, type McpServerHandle, type McpServerOptions } from "./internal/mcpServer.ts";

/**
 * Start the MCP server with SSE and streamable HTTP transports.
 *
 * Registers all tools from the tool registry and listens for
 * incoming connections from ChatGPT via the Cloudflare tunnel.
 *
 * @param repoRoot - Absolute repository root.
 * @param port - Port value.
 * @param options - Options that configure the operation.
 * @returns The `startMcpServer` result.
 * @example
 * ```ts
 * const result = await startMcpServer(repoRoot, port, options);
 * ```
 */
export const startMcpServer = (
  repoRoot: string,
  port: number,
  options: McpServerOptions = {},
): Promise<McpServerHandle> => {
  const server = new McpServer(repoRoot, options);
  return server.start(port).then((url) => ({ url, close: () => server.stop() }));
};
