import { z } from "zod";
import { ensureInsideRepo } from "../sandbox.ts";
import type { ToolDef } from "../../domain/types.ts";
import { runProcess } from "./process.ts";
import { buildRgArgs, grepResultOutput, type BuildRgArgsInput } from "./grep.helpers.ts";

/** Grep the repository using ripgrep with line numbers. */
async function grepCode(
  args: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> {
  const input = readGrepInput(args);
  const result = await runProcess(buildRgArgs(input), input.repoRoot, { timeoutMs: 20_000 });
  return grepResultOutput(result);
}

function readGrepInput(args: Record<string, unknown>): BuildRgArgsInput & { repoRoot: string } {
  const repoRoot = String(args._repoRoot);
  return {
    pattern: String(args.pattern),
    safePath: ensureInsideRepo(String(args.path), repoRoot),
    glob: args.glob ? String(args.glob) : undefined,
    repoRoot,
  };
}

export const grepTool: ToolDef = {
  name: "grep_code",
  description:
    "Search the repository using ripgrep. Locate symbols, imports, routes, tests, configs, and references.",
  annotations: {
    title: "Search repo",
    readOnlyHint: true,
    openWorldHint: false,
  },
  parameters: {
    pattern: z.string().describe("The ripgrep search pattern."),
    path: z.string().describe("Repo-relative path to search."),
    glob: z.string().optional().describe("Optional ripgrep glob, e.g. '*.ts'."),
  },
  handler: grepCode,
};
