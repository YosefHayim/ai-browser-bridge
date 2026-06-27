import { readFile } from "node:fs/promises";
import { trimOutput } from "../sandbox.ts";

/** Inputs for reading a bounded slice of a file with line numbers. */
export interface ReadFileSliceInput {
  safePath: string;
  path: string;
  startLine: number;
  maxLines: number;
}

/** Read a file slice and format it with line numbers and a header. */
export async function readNumberedSlice(input: ReadFileSliceInput): Promise<{ ok: true; output: string }> {
  const raw = await readFile(input.safePath, "utf-8");
  const lines = raw.split("\n");
  const start = Math.max(input.startLine - 1, 0);
  const end = Math.min(start + input.maxLines, lines.length);
  return { ok: true, output: trimOutput(buildNumberedSliceOutput({ lines, start, end, path: input.path })) };
}

function buildNumberedSliceOutput(input: { lines: string[]; start: number; end: number; path: string }): string {
  const header = `path: ${input.path}\nlines: ${input.start + 1}-${input.end} of ${input.lines.length}\n`;
  return header + formatNumberedLines({ lines: input.lines, start: input.start, end: input.end });
}

function formatNumberedLines(input: { lines: string[]; start: number; end: number }): string {
  let text = "";
  for (let index = input.start; index < input.end; index += 1) {
    text += `${index + 1}: ${input.lines[index]}\n`;
  }
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}
