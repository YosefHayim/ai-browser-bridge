import type { McpToolAction } from "./mcp-server-types.ts";
import type { ToolResult } from "../domain/types.ts";

/** Map a tool result to an MCP action status. */
export function toolActionStatus(result: ToolResult, blocked: boolean): McpToolAction["status"] {
  if (blocked) return "blocked";
  return result.ok ? "completed" : "failed";
}

/** Strip internal handler fields from logged tool args. */
export function sanitizeToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (key === "_repoRoot") continue;
    clean[key] = value;
  }
  return clean;
}
