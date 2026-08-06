import { readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { repositoryPath } from "./paths.ts";

// @src/main.ts style mentions — capture group 1 is the path after @.
// Raw row example: "@src/foo.ts" file mention should match.
const FILE_MENTION_RE = /@([\w./_-]+(?:\.[\w]+))/g;

/** Result of resolving a single @file mention. */
export interface PromptFile {
  relPath: string;
  content: string;
}

const readMentionContent = async (absPath: string, rawPath: string): Promise<string> => {
  try {
    const fileStat = await stat(absPath);
    if (!fileStat.isFile()) return `[not a file: ${rawPath}]`;
    if (fileStat.size > 100_000) return `[file too large: ${fileStat.size} bytes, max 100000]`;
    return await readFile(absPath, "utf-8");
  } catch {
    return `[file not found: ${rawPath}]`;
  }
};

const mentionExpansion = (input: {
  prompt: string;
  match: string;
  relPath: string;
  content: string;
}) => {
  const block = `\n--- @${input.relPath} ---\n${input.content}\n--- end @${input.relPath} ---\n`;
  return {
    prompt: input.prompt.replace(input.match, block),
    file: { relPath: input.relPath, content: input.content },
  };
};

const expandFileMention = async (input: {
  match: RegExpMatchArray;
  repoRoot: string;
  prompt: string;
}): Promise<{ prompt: string; file?: PromptFile }> => {
  const rawPath = input.match[1];
  if (rawPath === undefined) return { prompt: input.prompt };
  const filePath = resolve(input.repoRoot, rawPath);
  const relPath = relative(input.repoRoot, filePath);
  try {
    repositoryPath(input.repoRoot, filePath);
  } catch {
    return { prompt: input.prompt };
  }
  const content = await readMentionContent(filePath, rawPath);
  return mentionExpansion({ prompt: input.prompt, match: input.match[0], relPath, content });
};

const expandAllFileMentions = async (input: {
  input: string;
  repoRoot: string;
  matches: RegExpMatchArray[];
}): Promise<{ prompt: string; files: PromptFile[] }> => {
  const files: PromptFile[] = [];
  let prompt = input.input;
  for (const match of input.matches) {
    const expansion = await expandFileMention({ match, repoRoot: input.repoRoot, prompt });
    prompt = expansion.prompt;
    if (expansion.file) files.push(expansion.file);
  }
  return { prompt, files };
};

/**
 * Extract repo-relative @file mentions from terminal input.
 *
 * @param input - Input values for the operation.
 * @returns The `extractFileMentions` result.
 * @example
 * ```ts
 * const result = extractFileMentions(input);
 * ```
 */
export const extractFileMentions = (input: string): string[] => {
  // FILE_MENTION_RE matches mentions like @src/main.ts.
  // Capture group 1 is the repo-relative path after @.
  const mentions = [...input.matchAll(FILE_MENTION_RE)]
    .map((match) => match[1])
    .filter((mention): mention is string => mention !== undefined);
  return [...new Set(mentions)];
};

/**
 * Parse @file mentions from user input and resolve them to file contents.
 * Returns the processed prompt with file contents injected, plus the list of
 * resolved files for context tracking.
 *
 * @param input - Input values for the operation.
 * @param repoRoot - Absolute repository root.
 * @returns The `expandFileMentions` result.
 * @example
 * ```ts
 * const result = await expandFileMentions(input, repoRoot);
 * ```
 */
export const expandFileMentions = async (
  input: string,
  repoRoot: string,
): Promise<{ prompt: string; files: PromptFile[] }> => {
  const matches = [...input.matchAll(FILE_MENTION_RE)];
  if (matches.length === 0) return { prompt: input, files: [] };
  return expandAllFileMentions({ input, repoRoot, matches });
};
