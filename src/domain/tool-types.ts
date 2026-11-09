import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import type { ToolResult } from "./message-types.ts";

export type ToolDef = {
  name: string;
  description: string;
  argsSchema: z.ZodObject;
  annotations?: ToolAnnotations;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
};
