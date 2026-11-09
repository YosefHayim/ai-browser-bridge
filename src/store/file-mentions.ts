import { readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { hasErrorCode } from "@/domain/errors.ts";
import { repositoryPath } from "./paths.ts";

// @src/main.ts style mentions — named capture is the path after @.
const FILE_MENTION_RE = /@(?<path>[\w./_-]+(?:\.[\w]+))/g;

export type PromptFile = {
  relativePath: string;
  content: string;
};

const isPathEscapeError = (error: unknown): boolean => {
  return error instanceof Error && error.message.startsWith("Path escapes repo root");
};

const readMentionContent = async (absolutePath: string, rawPath: string): Promise<string> => {
  try {
    const fileStat = await stat(absolutePath);
    const isNotFileFileStat = !fileStat.isFile();
    if (isNotFileFileStat) return `[not a file: ${rawPath}]`;

    const isFileStatSizeAbove100000 = fileStat.size > 100_000;
    if (isFileStatSizeAbove100000) return `[file too large: ${fileStat.size} bytes, max 100000]`;

    return await readFile(absolutePath, "utf-8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return `[file not found: ${rawPath}]`;

    throw error;
  }
};

const mentionExpansion = (input: {
  prompt: string;
  match: string;
  relativePath: string;
  content: string;
}) => {
  const block = `\n--- @${input.relativePath} ---\n${input.content}\n--- end @${input.relativePath} ---\n`;
  return {
    prompt: input.prompt.replace(input.match, block),
    file: { relativePath: input.relativePath, content: input.content } satisfies PromptFile,
  };
};

const expandFileMention = async (input: {
  match: RegExpMatchArray;
  repoRoot: string;
  prompt: string;
}): Promise<{ prompt: string; file?: PromptFile }> => {
  const rawPath = input.match.groups?.path;
  const isPathMissing = rawPath === undefined;
  if (isPathMissing) return { prompt: input.prompt };

  const filePath = resolve(input.repoRoot, rawPath);
  const relativePath = relative(input.repoRoot, filePath);
  try {
    repositoryPath(input.repoRoot, filePath);
  } catch (error) {
    if (isPathEscapeError(error)) return { prompt: input.prompt };

    throw error;
  }
  const content = await readMentionContent(filePath, rawPath);
  return mentionExpansion({
    prompt: input.prompt,
    match: input.match[0],
    relativePath,
    content,
  });
};

const expandAllFileMentions = async (input: {
  prompt: string;
  repoRoot: string;
  matches: RegExpMatchArray[];
}): Promise<{ prompt: string; files: PromptFile[] }> => {
  const files: PromptFile[] = [];
  let prompt = input.prompt;
  for (const match of input.matches) {
    const expansion = await expandFileMention({ match, repoRoot: input.repoRoot, prompt });
    prompt = expansion.prompt;

    const hasExpansionFile = expansion.file !== undefined;
    if (hasExpansionFile) files.push(expansion.file);
  }
  return { prompt, files };
};

export const extractFileMentions = (input: string): string[] => {
  const mentions = [...input.matchAll(FILE_MENTION_RE)]
    .map((match) => match.groups?.path)
    .filter((mention): mention is string => mention !== undefined);
  return [...new Set(mentions)];
};

export const expandFileMentions = async (
  input: string,
  repoRoot: string,
): Promise<{ prompt: string; files: PromptFile[] }> => {
  const matches = [...input.matchAll(FILE_MENTION_RE)];

  const isMatchesEmpty = matches.length === 0;
  if (isMatchesEmpty) return { prompt: input, files: [] };

  return expandAllFileMentions({ prompt: input, repoRoot, matches });
};
