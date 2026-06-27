import { stat } from "node:fs/promises";
import { z } from "zod";
import { ensureInsideRepo } from "../sandbox.ts";
import type { ToolDef } from "../../domain/types.ts";
import { readNumberedSlice } from "./read-file.helpers.ts";

/** Read a repo file with line numbers. */
async function readFileTool(
  args: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> {
  const input = readFileToolInput(args);
  const invalid = await assertReadableFile({ safePath: input.safePath, path: input.path });
  if (invalid) return invalid;
  return await readNumberedSlice(input);
}

function readFileToolInput(args: Record<string, unknown>): {
  safePath: string;
  path: string;
  startLine: number;
  maxLines: number;
} {
  const path = String(args.path);
  const repoRoot = String(args._repoRoot);
  return {
    path,
    safePath: ensureInsideRepo(path, repoRoot),
    startLine: Number(args.start_line ?? 1),
    maxLines: Number(args.max_lines ?? 200),
  };
}

async function assertReadableFile(input: { safePath: string; path: string }): Promise<{ ok: false; output: string } | null> {
  try {
    const fileStat = await stat(input.safePath);
    if (!fileStat.isFile()) return { ok: false, output: `Not a file: ${input.path}` };
  } catch {
    return { ok: false, output: `File not found: ${input.path}` };
  }
  return null;
}

export const readFileDef: ToolDef = {
  name: "read_file",
  description: "Read a repo file with line numbers. Use after grep_code before proposing edits.",
  annotations: {
    title: "Read file",
    readOnlyHint: true,
    openWorldHint: false,
  },
  parameters: {
    path: z.string().describe("Repo-relative file path."),
    start_line: z.number().optional().describe("1-based line number to start reading."),
    max_lines: z.number().optional().describe("Maximum number of lines to read."),
  },
  handler: readFileTool,
};
