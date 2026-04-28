import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface ProjectInstructionFile {
  fileName: "AGENTS.md" | "CLAUDE.md";
  content: string;
}

export interface ProjectInstructions {
  files: ProjectInstructionFile[];
  promptText: string;
}

const PROJECT_INSTRUCTION_FILES: Array<ProjectInstructionFile["fileName"]> = ["AGENTS.md", "CLAUDE.md"];

/** Load repo-root project instructions for /task prompt augmentation. */
export async function loadProjectInstructions(repoRoot: string): Promise<ProjectInstructions> {
  const files: ProjectInstructionFile[] = [];

  for (const fileName of PROJECT_INSTRUCTION_FILES) {
    const content = await readOptionalFile(join(repoRoot, fileName));
    if (content !== null) {
      files.push({ fileName, content: content.trim() });
    }
  }

  return {
    files,
    promptText: renderProjectInstructions(files),
  };
}

/** Render instruction files with stable headings so multiple files stay distinct. */
export function renderProjectInstructions(files: readonly ProjectInstructionFile[]): string {
  return files
    .filter((file) => file.content.trim())
    .map((file) => `## Project Instructions: ${file.fileName}\n${file.content.trim()}`)
    .join("\n\n");
}

async function readOptionalFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
