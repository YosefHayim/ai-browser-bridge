import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { hasErrorCode } from "@/features/domain";

const PROJECT_INSTRUCTION_FILE_NAMES = ["AGENTS.md", "CLAUDE.md"] as const;

export type ProjectInstructionFile = {
  readonly fileName: (typeof PROJECT_INSTRUCTION_FILE_NAMES)[number];
  readonly content: string;
};

export type ProjectInstructions = {
  readonly files: ProjectInstructionFile[];
  readonly promptText: string;
};

export const loadProjectInstructions = async (repoRoot: string): Promise<ProjectInstructions> => {
  const files: ProjectInstructionFile[] = [];
  for (const fileName of PROJECT_INSTRUCTION_FILE_NAMES) {
    const content = await readOptionalFile(join(repoRoot, fileName));
    if (content === undefined) continue;
    files.push({ fileName, content: content.trim() });
  }
  return {
    files,
    promptText: renderProjectInstructions(files),
  };
};

export const renderProjectInstructions = (files: readonly ProjectInstructionFile[]): string => {
  const sections: string[] = [];
  for (const file of files) {
    const content = file.content.trim();
    if (content === "") continue;
    sections.push(`## Project Instructions: ${file.fileName}\n${content}`);
  }
  return sections.join("\n\n");
};

const readOptionalFile = async (path: string): Promise<string | undefined> => {
  try {
    return await readFile(path, "utf-8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
};
