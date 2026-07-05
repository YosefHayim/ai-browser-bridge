import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ZodMiniType } from "zod/v4-mini";
import type { ToolResult } from "./messageTypes.ts";

/**
 * MCP tool registration entry.
 *
 * Parameters use Zod because the MCP SDK requires it for tool registration.
 * This is the ONLY place Zod types surface in the domain — confined to the MCP boundary.
 */
export interface ToolDef {
  /** Registered tool name exposed to the model. */
  name: string;
  /** Human-readable tool description for the model. */
  description: string;
  /** Zod-validated parameter schema (MCP SDK requirement). */
  parameters: Record<string, ZodMiniType>;
  /** Optional MCP tool annotations. */
  annotations?: ToolAnnotations;
  /** Async handler invoked with validated arguments. */
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}
