import { readdir } from "node:fs/promises";
import { ensureInsideRepo } from "../../tools/sandbox.ts";
import {
  compareCompletionMatches,
  findActiveFileMention,
  isUnsafePartial,
  normalizePartialPath,
} from "./file-autocomplete.helpers.ts";
import {
  DEFAULT_COMPLETION_LIMIT,
  IGNORED_COMPLETION_ENTRIES,
  type FileCompletionMatch,
  type FileCompletionOptions,
  type FileCompletionResult,
} from "./file-autocomplete.types.ts";

/** Complete an active `@file` mention against files inside the repo. */
export async function completeFileMention(
  input: string,
  repoRoot: string,
  options: FileCompletionOptions = {},
): Promise<FileCompletionResult | null> {
  const active = findActiveFileMention(input);
  if (!active) return null;
  const partial = normalizePartialPath(active.partial);
  if (isUnsafePartial(partial)) return null;
  return buildFileCompletionResult({ active, partial, repoRoot, limit: options.limit ?? DEFAULT_COMPLETION_LIMIT });
}

/** Build a completion result when matches exist for a partial mention. */
async function buildFileCompletionResult(input: {
  active: NonNullable<ReturnType<typeof findActiveFileMention>>;
  partial: string;
  repoRoot: string;
  limit: number;
}): Promise<FileCompletionResult | null> {
  const matches = await listCompletionMatches({ partial: input.partial, repoRoot: input.repoRoot, limit: input.limit });
  if (matches.length === 0) return null;
  return { ...input.active, partial: input.partial, replacement: matches[0].path, matches };
}

interface ListMatchesInput {
  partial: string;
  repoRoot: string;
  limit: number;
}

async function listCompletionMatches(input: ListMatchesInput): Promise<FileCompletionMatch[]> {
  const parts = splitPartialPath(input.partial);
  const absoluteSearchDir = resolveCompletionSearchDir({ dirPrefix: parts.dirPrefix, repoRoot: input.repoRoot });
  if (!absoluteSearchDir) return [];
  return readCompletionMatches({ ...input, ...parts, absoluteSearchDir });
}

/** Split a partial mention path into directory and name prefixes. */
function splitPartialPath(partial: string): { dirPrefix: string; namePrefix: string } {
  const lastSlashIndex = partial.lastIndexOf("/");
  return {
    dirPrefix: lastSlashIndex === -1 ? "" : partial.slice(0, lastSlashIndex),
    namePrefix: lastSlashIndex === -1 ? partial : partial.slice(lastSlashIndex + 1),
  };
}

/** Resolve the absolute directory to search for completion matches. */
function resolveCompletionSearchDir(input: { dirPrefix: string; repoRoot: string }): string | null {
  try {
    return ensureInsideRepo(input.dirPrefix || ".", input.repoRoot);
  } catch {
    return null;
  }
}

/** Read and filter directory entries into completion matches. */
async function readCompletionMatches(input: ListMatchesInput & {
  dirPrefix: string;
  namePrefix: string;
  absoluteSearchDir: string;
}): Promise<FileCompletionMatch[]> {
  try {
    const dirents = await readdir(input.absoluteSearchDir, { withFileTypes: true });
    return dirents
      .filter((dirent) => dirent.isDirectory() || dirent.isFile())
      .filter((dirent) => !IGNORED_COMPLETION_ENTRIES.has(dirent.name))
      .filter((dirent) => input.namePrefix.startsWith(".") || !dirent.name.startsWith("."))
      .filter((dirent) => dirent.name.startsWith(input.namePrefix))
      .map((dirent) => mapDirent({ dirent, dirPrefix: input.dirPrefix }))
      .sort((...args: [FileCompletionMatch, FileCompletionMatch]) => compareCompletionMatches(args[0], args[1]))
      .slice(0, input.limit);
  } catch {
    return [];
  }
}

function mapDirent(input: { dirent: { name: string; isDirectory(): boolean }; dirPrefix: string }): FileCompletionMatch {
  const path = input.dirPrefix ? `${input.dirPrefix}/${input.dirent.name}` : input.dirent.name;
  return { path: input.dirent.isDirectory() ? `${path}/` : path, isDirectory: input.dirent.isDirectory() };
}
