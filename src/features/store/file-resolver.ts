import { resolveOneFileMention, type ResolvedFile } from "./file-resolver.helpers.ts";

const FILE_MENTION_RE = /@([\w./_-]+(?:\.[\w]+))/g;

/** Extract repo-relative @file mentions from terminal input. */
export function extractFileMentions(input: string): string[] {
  const mentions = [...input.matchAll(FILE_MENTION_RE)].map((match) => match[1]);
  return [...new Set(mentions)];
}

/**
 * Parse @file mentions from user input and resolve them to file contents.
 * Returns the processed prompt with file contents injected, plus the list of
 * resolved files for context tracking.
 */
export async function resolveFileMentions(
  input: string,
  repoRoot: string,
): Promise<{ prompt: string; files: ResolvedFile[] }> {
  const matches = [...input.matchAll(FILE_MENTION_RE)];
  if (matches.length === 0) return { prompt: input, files: [] };
  return resolveAllFileMentions({ input, repoRoot, matches });
}

/** Resolve every @file mention in order. */
async function resolveAllFileMentions(input: {
  input: string;
  repoRoot: string;
  matches: RegExpMatchArray[];
}): Promise<{ prompt: string; files: ResolvedFile[] }> {
  const files: ResolvedFile[] = [];
  let prompt = input.input;
  for (const match of input.matches) {
    const result = await resolveOneFileMention({ match, repoRoot: input.repoRoot, prompt, files });
    prompt = result.prompt;
    if (result.file) files.push(result.file);
  }
  return { prompt, files };
}
