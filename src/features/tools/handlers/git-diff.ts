import { trimOutput } from "../sandbox.ts";
import type { ToolDef } from "../../domain/types.ts";
import { runProcess } from "./process.ts";

/** Show the current git diff and diff stat. */
async function gitDiff(
  args: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> {
  const repoRoot = String(args._repoRoot);

  const [stat, diff] = await Promise.all([
    runProcess(["git", "diff", "--stat"], repoRoot, { timeoutMs: 10_000 }),
    runProcess(["git", "diff"], repoRoot, { timeoutMs: 20_000 }),
  ]);

  const combined = `--- stat ---\n${stat.stdout}\n\n--- diff ---\n${diff.stdout}`;
  return { ok: true, output: trimOutput(combined) };
}

export const gitDiffTool: ToolDef = {
  name: "git_diff",
  description: "Show the current git diff and diff stat for the working tree.",
  annotations: {
    title: "Show git diff",
    readOnlyHint: true,
    openWorldHint: false,
  },
  parameters: {},
  handler: gitDiff,
};
