import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { Schema } from "effect";
import type { ToolResult } from "./messageTypes.ts";

/**
 * MCP tool registration entry.
 *
 * Argument shapes are Effect Schema (SSOT). At the MCP registration edge they
 * are converted to a Zod raw shape because the MCP SDK requires Zod on the wire.
 */
export type ToolDef = {
  name: string;
  description: string;
  argsSchema: Schema.Schema.Any;
  annotations?: ToolAnnotations;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
};
