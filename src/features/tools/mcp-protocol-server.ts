import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toolRegistry } from "./handlers/registry.ts";
import type { McpServerOptions } from "./mcp-server-types.ts";
import { handleToolCall } from "./mcp-tool-handler.ts";

/** Inputs for building one MCP tool handler. */
interface CreateToolHandlerParams {
  repoRoot: string;
  options: McpServerOptions;
  name: string;
}

/** Create an MCP server with all registered bridge tools. */
export function createMcpProtocolServer(repoRoot: string, options: McpServerOptions): McpServer {
  const mcp = new McpServer({ name: "ai-browser-bridge", version: "0.1.0" });
  for (const [name, tool] of toolRegistry) {
    mcp.tool(name, tool.description, tool.parameters, tool.annotations ?? {}, createToolHandler({ repoRoot, options, name }));
  }
  return mcp;
}

/** Build the async handler for one registered tool. */
function createToolHandler(params: CreateToolHandlerParams) {
  const tool = toolRegistry.get(params.name);
  if (!tool) throw new Error(`Missing tool: ${params.name}`);
  return async (args: Record<string, unknown>) => handleToolCall({ ...params, tool, args });
}
