import type { ToolReport } from "@/message-types.ts";
import { applyPatchTool } from "@/repo-tools-mcp/apply-patch-tool.ts";
import {
  downloadAllAttachmentsTool,
  downloadAttachmentTool,
  listAttachmentsTool,
} from "@/repo-tools-mcp/chatgpt-attachment-tools.ts";
import { grepTool } from "@/repo-tools-mcp/grep-code-tool.ts";
import { runProcess } from "@/repo-tools-mcp/process-runner.ts";
import { readFileTool } from "@/repo-tools-mcp/read-file-tool.ts";
import { runTestsTool } from "@/repo-tools-mcp/run-tests-tool.ts";
import { GitDiffArgumentListSchema } from "@/repo-tools-mcp/tools-schemas.ts";
import { trimPrintout } from "@/repo-tools-mcp/trim-printout.ts";
import type { ToolDef } from "@/tool-types.ts";

const GIT_COMMAND = "git";

const DIFF_ARGUMENT = "diff";

const gitDiffTimeoutMilliseconds = 20_000;

const gitDiffStatTimeoutMilliseconds = 10_000;

async function readGitDiff(argumentList: Record<string, unknown>): Promise<ToolReport> {
  const repoRoot = String(argumentList._repoRoot);
  const statProcess = runProcess([GIT_COMMAND, DIFF_ARGUMENT, "--stat"], repoRoot, {
    timeoutMilliseconds: gitDiffStatTimeoutMilliseconds,
  });
  const diffProcess = runProcess([GIT_COMMAND, DIFF_ARGUMENT], repoRoot, {
    timeoutMilliseconds: gitDiffTimeoutMilliseconds,
  });
  const [stat, diff] = await Promise.all([statProcess, diffProcess]);
  const combinedPrintout = `--- stat ---\n${stat.stdout}\n\n--- diff ---\n${diff.stdout}`;

  return { ok: true, output: trimPrintout(combinedPrintout) };
}

const gitDiffTool: ToolDef = {
  name: "git_diff",
  description: "Show the current git diff and diff stat for the working tree.",
  annotations: { title: "Show git diff", readOnlyHint: true, openWorldHint: false },
  argsSchema: GitDiffArgumentListSchema,
  handler: readGitDiff,
};

function pairToolWithName(tool: ToolDef): [string, ToolDef] {
  return [tool.name, tool];
}

const toolList: ToolDef[] = [
  grepTool,
  readFileTool,
  applyPatchTool,
  runTestsTool,
  gitDiffTool,
  listAttachmentsTool,
  downloadAttachmentTool,
  downloadAllAttachmentsTool,
];

export const toolRegistry: Map<string, ToolDef> = new Map(toolList.map(pairToolWithName));
