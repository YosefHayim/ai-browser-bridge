import { readdir } from "node:fs/promises";
import { isAbsolute, sep } from "node:path";
import { ensureInsideRepo } from "../mcp/sandbox.ts";

export interface ActiveFileMention {
  start: number;
  end: number;
  partial: string;
}

export interface FileCompletionMatch {
  path: string;
  isDirectory: boolean;
}

export interface FileCompletionResult extends ActiveFileMention {
  replacement: string;
  matches: FileCompletionMatch[];
}

interface FileCompletionOptions {
  limit?: number;
}

const DEFAULT_COMPLETION_LIMIT = 20;
const IGNORED_COMPLETION_ENTRIES = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".turbo"]);

export function findActiveFileMention(
  input: string,
  cursor = input.length,
): ActiveFileMention | null {
  const beforeCursor = input.slice(0, cursor);
  const start = beforeCursor.lastIndexOf("@");
  if (start === -1) return null;

  const previous = start > 0 ? beforeCursor[start - 1] : "";
  if (previous && !/\s/.test(previous)) return null;

  const partial = beforeCursor.slice(start + 1);
  if (/\s/.test(partial)) return null;

  return { start, end: cursor, partial };
}

export async function completeFileMention(
  input: string,
  repoRoot: string,
  options: FileCompletionOptions = {},
): Promise<FileCompletionResult | null> {
  const active = findActiveFileMention(input);
  if (!active) return null;

  const partial = normalizePartialPath(active.partial);
  if (isUnsafePartial(partial)) return null;

  const lastSlashIndex = partial.lastIndexOf("/");
  const dirPrefix = lastSlashIndex === -1 ? "" : partial.slice(0, lastSlashIndex);
  const namePrefix = lastSlashIndex === -1 ? partial : partial.slice(lastSlashIndex + 1);
  const searchDir = dirPrefix || ".";

  let absoluteSearchDir: string;
  try {
    absoluteSearchDir = ensureInsideRepo(searchDir, repoRoot);
  } catch {
    return null;
  }

  let entries: FileCompletionMatch[];
  try {
    const dirents = await readdir(absoluteSearchDir, { withFileTypes: true });
    entries = dirents
      .filter((dirent) => dirent.isDirectory() || dirent.isFile())
      .filter((dirent) => !IGNORED_COMPLETION_ENTRIES.has(dirent.name))
      .filter((dirent) => namePrefix.startsWith(".") || !dirent.name.startsWith("."))
      .filter((dirent) => dirent.name.startsWith(namePrefix))
      .map((dirent) => {
        const path = dirPrefix ? `${dirPrefix}/${dirent.name}` : dirent.name;
        return {
          path: dirent.isDirectory() ? `${path}/` : path,
          isDirectory: dirent.isDirectory(),
        };
      })
      .sort(compareCompletionMatches)
      .slice(0, options.limit ?? DEFAULT_COMPLETION_LIMIT);
  } catch {
    return null;
  }

  if (entries.length === 0) return null;

  return {
    ...active,
    partial,
    replacement: entries[0].path,
    matches: entries,
  };
}

export function applyFileCompletion(input: string, completion: FileCompletionResult): string {
  return `${input.slice(0, completion.start + 1)}${completion.replacement}${input.slice(completion.end)}`;
}

function normalizePartialPath(partial: string): string {
  return partial.replaceAll("\\", "/").replaceAll(sep, "/");
}

function isUnsafePartial(partial: string): boolean {
  if (isAbsolute(partial) || partial.startsWith("/")) return true;
  const parts = partial.split("/").filter(Boolean);
  return parts.includes("..");
}

function compareCompletionMatches(left: FileCompletionMatch, right: FileCompletionMatch): number {
  if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
  return left.path.localeCompare(right.path);
}
