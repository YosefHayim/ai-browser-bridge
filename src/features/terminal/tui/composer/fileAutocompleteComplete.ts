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

const splitPartialPath = (partial: string): { dirPrefix: string; namePrefix: string } => {
  const lastSlashIndex = partial.lastIndexOf("/");
  if (lastSlashIndex === -1) {
    return { dirPrefix: "", namePrefix: partial };
  }
  return {
    dirPrefix: partial.slice(0, lastSlashIndex),
    namePrefix: partial.slice(lastSlashIndex + 1),
  };
};

const completionSearchDirectory = (input: {
  dirPrefix: string;
  repoRoot: string;
}): string | undefined => {
  const relativeDir = input.dirPrefix === "" ? "." : input.dirPrefix;
  try {
    return repositoryPath(input.repoRoot, relativeDir);
  } catch {
    return undefined;
  }
};

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
      .sort((left, right) => compareCompletionMatches(left, right))
      .slice(0, input.limit);
  } catch {
    return [];
  }
};

const mapDirent = (input: {
  dirent: { name: string; isDirectory(): boolean };
  dirPrefix: string;
}): FileCompletionMatch => {
  const relativePath =
    input.dirPrefix === "" ? input.dirent.name : `${input.dirPrefix}/${input.dirent.name}`;
  if (input.dirent.isDirectory()) {
    return { path: `${relativePath}/`, isDirectory: true };
  }
  return { path: relativePath, isDirectory: false };
};
