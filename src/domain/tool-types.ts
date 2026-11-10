import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import type { ToolReport } from "./message-types.ts";

export type ToolDef = {
  name: string;
  description: string;
  argsSchema: z.ZodObject;
  annotations?: ToolAnnotations;
  handler: (argumentList: Record<string, unknown>) => Promise<ToolReport>;
};
