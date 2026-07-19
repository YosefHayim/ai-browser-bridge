import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { Schema } from "effect";
import type { ToolResult } from "./messageTypes.ts";

/**
 * MCP tool registration entry.
 *
 * Argument shapes are Effect Schema (SSOT). At the MCP registration edge they are
 * converted to a Zod raw shape via {@link effectSchemaToMcpShape} because the MCP
 * SDK requires Zod on the wire.
 */
export interface ToolDef {
  /** Registered tool name exposed to the model. */
  name: string;
  /** Human-readable tool description for the model. */
  description: string;
  /** Effect Schema for tool arguments (converted to MCP Zod shape at registration). */
  argsSchema: Schema.Schema.Any;
  /** Optional MCP tool annotations. */
  annotations?: ToolAnnotations;
  /** Async handler invoked with validated arguments. */
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}
