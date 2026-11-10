import { readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { hasErrorCode } from "@/domain/errors.ts";
import { readRepositoryPath } from "./paths.ts";

// @src/main.ts style mentions — named capture is the path after @.
const FILE_MENTION_RE = /@(?<path>[\w./_-]+(?:\.[\w]+))/g;

export type PromptFile = {
  relativePath: string;
  content: string;
};

const isPathEscapeError = (error: unknown): boolean => {
  return error instanceof Error && error.message.startsWith("Path escapes repo root");
};

const readMentionMessage = async (absolutePath: string, unparsedPath: string): Promise<string> => {
  try {
    const fileStat = await stat(absolutePath);

    const isNotFileFileStat = !fileStat.isFile();
    if (isNotFileFileStat) return `[not a file: ${unparsedPath}]`;

    const largeFileByteLimit = 100_000;

    const isFileTooLarge = fileStat.size > largeFileByteLimit;
    if (isFileTooLarge) return `[file too large: ${fileStat.size} bytes, max 100000]`;

    return await readFile(absolutePath, "utf-8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return `[file not found: ${unparsedPath}]`;

    throw error;
  }
};

const readMentionExpansion = (details: {
  prompt: string;
  match: string;
  relativePath: string;
  content: string;
}) => {
  const block = `\n--- @${details.relativePath} ---\n${details.content}\n--- end @${details.relativePath} ---\n`;
  return {
    prompt: details.prompt.replace(details.match, block),
    file: { relativePath: details.relativePath, content: details.content } satisfies PromptFile,
  };
};

const expandFileMention = async (details: {
  match: RegExpMatchArray;
  repoRoot: string;
  prompt: string;
}): Promise<{ prompt: string; file?: PromptFile }> => {
  const unparsedPath = details.match.groups?.path;

  const isPathMissing = unparsedPath == null;
  if (isPathMissing) return { prompt: details.prompt };

  const filePath = resolve(details.repoRoot, unparsedPath);
  const relativePath = relative(details.repoRoot, filePath);
  try {
    readRepositoryPath(details.repoRoot, filePath);
  } catch (error) {
    if (isPathEscapeError(error)) return { prompt: details.prompt };

    throw error;
  }
  const message = await readMentionMessage(filePath, unparsedPath);
  return readMentionExpansion({
    prompt: details.prompt,
    match: details.match[0],
    relativePath,
    content: message,
  });
};

const expandAllFileMentions = async (details: {
  prompt: string;
  repoRoot: string;
  matches: RegExpMatchArray[];
}): Promise<{ prompt: string; files: PromptFile[] }> => {
  const files: PromptFile[] = [];
  let prompt = details.prompt;
  for (const hit of details.matches) {
    const expansion = await expandFileMention({ match: hit, repoRoot: details.repoRoot, prompt });
    prompt = expansion.prompt;

    const expandedFile = expansion.file;

    const hasExpandedFile = expandedFile != null;
    if (hasExpandedFile) files.push(expandedFile);
  }
  return { prompt, files };
};

export const extractFileMentions = (details: string): string[] => {
  const mentions = [...details.matchAll(FILE_MENTION_RE)]
    .map((hit) => hit.groups?.path)
    .filter((mention): mention is string => mention != null);
  return [...new Set(mentions)];
};

export const expandFileMentions = async (
  details: string,
  repoRoot: string,
): Promise<{ prompt: string; files: PromptFile[] }> => {
  const hits = [...details.matchAll(FILE_MENTION_RE)];

  const isHitsEmpty = hits.length === 0;
  if (isHitsEmpty) return { prompt: details, files: [] };

  return expandAllFileMentions({ prompt: details, repoRoot, matches: hits });
};
