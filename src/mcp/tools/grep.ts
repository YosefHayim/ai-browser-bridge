import { z } from "zod";
import { ensureInsideRepo, trimOutput } from "../sandbox.ts";
import type { ToolDef } from "../../types/types.ts";
import { runProcess } from "./process.ts";

/** Grep the repository using ripgrep with line numbers. */
async function grepCode(
  args: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> {
  const pattern = String(args.pattern);
  const path = String(args.path);
  const glob = args.glob ? String(args.glob) : undefined;
  const repoRoot = String(args._repoRoot);

  const safePath = ensureInsideRepo(path, repoRoot);

  const rgArgs = [
    "rg",
    "--line-number",
    "--hidden",
    "--glob", "!.git",
    "--glob", "!node_modules",
    "--glob", "!dist",
    "--glob", "!build",
  ];

  if (glob) {
    rgArgs.push("--glob", glob);
  }

  rgArgs.push(pattern, safePath);

  const result = await runProcess(rgArgs, repoRoot, { timeoutMs: 20_000 });

  // ripgrep exits with code 1 when no matches — that's not an error
  if (result.code === 1) {
    return { ok: true, output: "" };
  }

  if (result.code !== 0) {
    return { ok: false, output: result.stderr };
  }

  return { ok: true, output: trimOutput(result.stdout) };
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
