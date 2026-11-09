import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { Schema } from "effect";

export type RepoToolResult = {
  ok: boolean;
  output: string;
  error?: string;
};

/**
 * MCP tool registration entry.
 *
 * Argument shapes are Effect Schema (SSOT). At the MCP registration edge they
 * are converted to a Zod raw shape because the MCP SDK requires Zod on the wire.
 */
export type RepoToolDefinition = {
  name: string;
  description: string;
  argsSchema: Schema.Schema.Any;
  annotations?: ToolAnnotations;
  handler: (toolRequest: Record<string, unknown>) => Promise<RepoToolResult>;
};
