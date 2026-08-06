import { readdir } from "node:fs/promises";
import { repositoryPath } from "@/features/store";
import {
  DEFAULT_COMPLETION_LIMIT,
  type FileCompletionMatch,
  type FileCompletionOptions,
  type FileCompletionResult,
  IGNORED_COMPLETION_ENTRIES,
} from "./fileAutocompleteTypes.ts";
import {
  compareCompletionMatches,
  findActiveFileMention,
  isUnsafePartial,
  normalizePartialPath,
} from "./fileMentionCompletion.ts";

/** Complete an active `@file` mention against files inside the repo. */
export const completeFileMention = async (
  input: string,
  repoRoot: string,
  options: FileCompletionOptions = {},
): Promise<FileCompletionResult | undefined> => {
  const active = findActiveFileMention({ input });
  if (active === undefined) return undefined;
  const partial = normalizePartialPath(active.partial);
  if (isUnsafePartial(partial)) return undefined;
  const limit = options.limit === undefined ? DEFAULT_COMPLETION_LIMIT : options.limit;
  return fileCompletion({
    active,
    partial,
    repoRoot,
    limit,
  });
};

/** Build a completion result when matches exist for a partial mention. */
const fileCompletion = async (input: {
  active: NonNullable<ReturnType<typeof findActiveFileMention>>;
  partial: string;
  repoRoot: string;
  limit: number;
}): Promise<FileCompletionResult | undefined> => {
  const matches = await listCompletionMatches({
    partial: input.partial,
    repoRoot: input.repoRoot,
    limit: input.limit,
  });
  const best = matches[0];
  if (best === undefined) return undefined;
  return { ...input.active, partial: input.partial, replacement: best.path, matches };
};

type ListMatchesInput = {
  partial: string;
  repoRoot: string;
  limit: number;
};

const listCompletionMatches = async (input: ListMatchesInput): Promise<FileCompletionMatch[]> => {
  const parts = splitPartialPath(input.partial);
  const absoluteSearchDir = completionSearchDirectory({
    dirPrefix: parts.dirPrefix,
    repoRoot: input.repoRoot,
  });
  if (absoluteSearchDir === undefined) return [];
  return readCompletionMatches({ ...input, ...parts, absoluteSearchDir });
};

/** Split a partial mention path into directory and name prefixes. */
const splitPartialPath = (partial: string): { dirPrefix: string; namePrefix: string } => {
  const lastSlashIndex = partial.lastIndexOf("/");
  return {
    dirPrefix: lastSlashIndex === -1 ? "" : partial.slice(0, lastSlashIndex),
    namePrefix: lastSlashIndex === -1 ? partial : partial.slice(lastSlashIndex + 1),
  };
};

/** Resolve the absolute directory to search for completion matches. */
const completionSearchDirectory = (input: {
  dirPrefix: string;
  repoRoot: string;
}): string | undefined => {
  try {
    return repositoryPath(input.repoRoot, input.dirPrefix || ".");
  } catch {
    return undefined;
  }
};

/** Read and filter directory entries into completion matches. */
const readCompletionMatches = async (
  input: ListMatchesInput & {
    dirPrefix: string;
    namePrefix: string;
    absoluteSearchDir: string;
  },
): Promise<FileCompletionMatch[]> => {
  try {
    const dirents = await readdir(input.absoluteSearchDir, { withFileTypes: true });
    return dirents
      .filter((dirent) => dirent.isDirectory() || dirent.isFile())
      .filter((dirent) => !IGNORED_COMPLETION_ENTRIES.has(dirent.name))
      .filter((dirent) => input.namePrefix.startsWith(".") || !dirent.name.startsWith("."))
      .filter((dirent) => dirent.name.startsWith(input.namePrefix))
      .map((dirent) => mapDirent({ dirent, dirPrefix: input.dirPrefix }))
      .sort((...args: [FileCompletionMatch, FileCompletionMatch]) =>
        compareCompletionMatches(args[0], args[1]),
      )
      .slice(0, input.limit);
  } catch {
    return [];
  }
};

const mapDirent = (input: {
  dirent: { name: string; isDirectory(): boolean };
  dirPrefix: string;
}): FileCompletionMatch => {
  const path = input.dirPrefix ? `${input.dirPrefix}/${input.dirent.name}` : input.dirent.name;
  return {
    path: input.dirent.isDirectory() ? `${path}/` : path,
    isDirectory: input.dirent.isDirectory(),
  };
};
