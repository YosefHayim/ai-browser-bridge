import { readFile, stat } from "node:fs/promises";
import type { ToolReport } from "@/message-types.ts";
import { readRepositoryPath } from "@/repo-files/paths.ts";
import { ReadFileArgumentListSchema } from "@/repo-tools-mcp/tools-schemas.ts";
import { trimPrintout } from "@/repo-tools-mcp/trim-printout.ts";
import type { ToolDef } from "@/tool-types.ts";

const NEWLINE = "\n";

const defaultMaxLines = 200;

type ReadFileSliceDetails = {
  safePath: string;
  path: string;
  startLine: number;
  maxLines: number;
};

async function readNumberedSlice(details: ReadFileSliceDetails): Promise<ToolReport> {
  const fileText = await readFile(details.safePath, "utf-8");
  const lines = fileText.split(NEWLINE);
  const start = Math.max(details.startLine - 1, 0);
  const end = Math.min(start + details.maxLines, lines.length);
  const numberedSlice = createNumberedSlice({ lines, start, end, path: details.path });

  return { ok: true, output: trimPrintout(numberedSlice) };
}

function createNumberedSlice(details: {
  lines: string[];
  start: number;
  end: number;
  path: string;
}): string {
  const header = `path: ${details.path}\nlines: ${details.start + 1}-${details.end} of ${details.lines.length}\n`;
  const numberedLines = writeNumberedLines(details.lines, details.start, details.end);

  return header + numberedLines;
}

function writeNumberedLines(lines: string[], start: number, end: number): string {
  const numberedLines: string[] = [];

  for (let index = start; index < end; index += 1) {
    numberedLines.push(`${index + 1}: ${lines[index]}`);
  }

  return numberedLines.join(NEWLINE);
}

async function readFileSlice(argumentList: Record<string, unknown>): Promise<ToolReport> {
  const details = readFileSliceDetails(argumentList);
  const unreadable = await findUnreadableFile(details.safePath, details.path);

  const isFileUnreadable = unreadable != null;
  if (isFileUnreadable) return unreadable;

  return await readNumberedSlice(details);
}

function readFileSliceDetails(argumentList: Record<string, unknown>): ReadFileSliceDetails {
  const path = String(argumentList.path);
  const repoRoot = String(argumentList._repoRoot);
  const isStartLineMissing = argumentList.start_line == null;
  const startLine = isStartLineMissing ? 1 : Number(argumentList.start_line);
  const isMaxLinesMissing = argumentList.max_lines == null;
  const maxLines = isMaxLinesMissing ? defaultMaxLines : Number(argumentList.max_lines);

  return { path, safePath: readRepositoryPath(repoRoot, path), startLine, maxLines };
}

async function findUnreadableFile(safePath: string, path: string): Promise<ToolReport | null> {
  try {
    const fileStat = await stat(safePath);

    const isNotFile = !fileStat.isFile();
    if (isNotFile) return { ok: false, output: `Not a file: ${path}` };
  } catch {
    return { ok: false, output: `File not found: ${path}` };
  }
  return null;
}

export const readFileTool: ToolDef = {
  name: "read_file",
  description: "Read a repo file with line numbers. Use after grep_code before proposing edits.",
  annotations: { title: "Read file", readOnlyHint: true, openWorldHint: false },
  argsSchema: ReadFileArgumentListSchema,
  handler: readFileSlice,
};
