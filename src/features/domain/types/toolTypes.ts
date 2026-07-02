import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ZodType } from "zod";
import type { ToolResult } from "./messageTypes.ts";

/** MCP tool registration entry. */
export interface ToolDef {
  /** Registered tool name exposed to the model. */
  name: string;
  /** Human-readable tool description for the model. */
  description: string;
  /** Zod-validated parameter schema keyed by argument name. */
  parameters: Record<string, ZodType>;
  /** Optional MCP tool annotations. */
  annotations?: ToolAnnotations;
  /** Async handler invoked with validated arguments. */
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}
