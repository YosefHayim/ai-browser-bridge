import { readFile, stat } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { ensureInsideRepo } from "../mcp/sandbox.ts";

const FILE_MENTION_RE = /@([\w./_-]+(?:\.[\w]+))/g;
const MAX_FILE_BYTES = 100_000;

/** Result of resolving a single @file mention. */
interface ResolvedFile {
  /** Repo-relative path */
  relPath: string;
  content: string;
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
  const files: ResolvedFile[] = [];
  const matches = [...input.matchAll(FILE_MENTION_RE)];

  if (matches.length === 0) {
    return { prompt: input, files };
  }

  let prompt = input;

  for (const match of matches) {
    const rawPath = match[1];
    const absPath = resolve(repoRoot, rawPath);
    const relPath = relative(repoRoot, absPath);

    if (!ensureInsideRepo(absPath, repoRoot)) {
      continue;
    }

    let content: string;
    try {
      const s = await stat(absPath);
      if (!s.isFile()) continue;
      if (s.size > MAX_FILE_BYTES) {
        content = `[file too large: ${s.size} bytes, max ${MAX_FILE_BYTES}]`;
      } else {
        content = await readFile(absPath, "utf-8");
      }
    } catch {
      content = `[file not found: ${rawPath}]`;
    }

    files.push({ relPath, content });

    const block = `\n--- @${relPath} ---\n${content}\n--- end @${relPath} ---\n`;
    prompt = prompt.replace(match[0], block);
  }

  return { prompt, files };
}
