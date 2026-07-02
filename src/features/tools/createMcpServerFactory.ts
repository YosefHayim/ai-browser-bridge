import { McpServer, type McpServerHandle, type McpServerOptions } from "./mcpServer.ts";

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
  const server = new McpServer(repoRoot, options);
  return server.start(port).then((url) => ({ url, close: () => server.stop() }));
}
