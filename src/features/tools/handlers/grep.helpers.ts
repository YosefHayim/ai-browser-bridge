import { trimOutput } from "../sandbox.ts";
import type { ProcessResult } from "./process.ts";

/** Inputs for building ripgrep CLI arguments. */
export interface BuildRgArgsInput {
  pattern: string;
  safePath: string;
  glob?: string;
}

/** Build ripgrep arguments with standard repo excludes. */
export function buildRgArgs(input: BuildRgArgsInput): string[] {
  const rgArgs = [
    "rg",
    "--line-number",
    "--hidden",
    "--glob", "!.git",
    "--glob", "!node_modules",
    "--glob", "!dist",
    "--glob", "!build",
  ];
  if (input.glob) rgArgs.push("--glob", input.glob);
  rgArgs.push(input.pattern, input.safePath);
  return rgArgs;
}

/** Map a ripgrep process result to a tool output payload. */
export function grepResultOutput(result: ProcessResult): { ok: boolean; output: string } {
  if (result.code === 1) return { ok: true, output: "" };
  if (result.code !== 0) return { ok: false, output: result.stderr };
  return { ok: true, output: trimOutput(result.stdout) };
}
