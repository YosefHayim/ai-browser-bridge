import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer } from "node:http";
import { toolRegistry } from "./tools/registry.ts";

/**
 * Start the MCP server with SSE transport.
 *
 * Registers all tools from the tool registry and listens for
 * incoming connections from ChatGPT via the Cloudflare tunnel.
 */
export function startMcpServer(repoRoot: string, port: number): Promise<{ url: string; close: () => void }> {
  const mcp = new McpServer({ name: "chatgpt-local-bridge", version: "0.1.0" });

  for (const [name, tool] of toolRegistry) {
    mcp.tool(
      name,
      tool.description,
      tool.parameters,
      async (args: Record<string, unknown>) => {
        const result = await tool.handler({ ...args, _repoRoot: repoRoot });
        return {
          content: [{ type: "text" as const, text: result.output }],
          isError: !result.ok,
        };
      },
    );
  }

  const httpServer = createServer();
  let transport: SSEServerTransport | null = null;

  httpServer.on("request", async (req, res) => {
    if (req.url === "/sse") {
      transport = new SSEServerTransport("/messages", res);
      mcp.connect(transport);
      return;
    }

    if (req.url === "/messages" && req.method === "POST") {
      if (transport) {
        await transport.handlePostMessage(req, res);
      } else {
        res.writeHead(503).end("No active SSE connection");
      }
      return;
    }

    res.writeHead(404).end("Not found");
  });

  return new Promise((resolve) => {
    httpServer.listen(port, () => {
      const close = () => {
        transport?.close();
        httpServer.close();
      };
      resolve({ url: `http://localhost:${port}`, close });
    });
  });
}
