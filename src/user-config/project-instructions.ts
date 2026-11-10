import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { hasErrorCode } from "@/domain/errors.ts";

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
    const filePath = join(repoRoot, fileName);
    const optionalFileString = await readOptionalFile(filePath);
    const isMessageMissing = optionalFileString == null;
    if (isMessageMissing) continue;

    const trimmedInstructions = optionalFileString.trim();
    files.push({ fileName, content: trimmedInstructions });
  }
  return {
    files,
    promptText: writeProjectInstructions(files),
  };
};

export const writeProjectInstructions = (files: readonly ProjectInstructionFile[]): string => {
  const sections: string[] = [];
  for (const file of files) {
    const message = file.content.trim();
    const isMessageEmpty = message === "";
    if (isMessageEmpty) continue;

    sections.push(`## Project Instructions: ${file.fileName}\n${message}`);
  }
  return sections.join("\n\n");
};

const readOptionalFile = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, "utf-8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;

    throw error;
  }
};
