import type { ToolDef } from "../../domain/types.ts";
import { grepTool } from "./grep.ts";
import { readFileDef } from "./read-file.ts";
import { applyPatchTool } from "./apply-patch.ts";
import { runTestsTool } from "./run-tests.ts";
import { gitDiffTool } from "./git-diff.ts";
import { attachmentTools } from "./attachments.ts";

/** All available MCP tools, indexed by name. */
export const toolRegistry: Map<string, ToolDef> = new Map();

for (const tool of [grepTool, readFileDef, applyPatchTool, runTestsTool, gitDiffTool, ...attachmentTools]) {
  toolRegistry.set(tool.name, tool);
}
