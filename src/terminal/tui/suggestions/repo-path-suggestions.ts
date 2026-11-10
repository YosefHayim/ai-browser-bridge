import { readdir } from "node:fs/promises";
import { extname, sep } from "node:path";
import { readRepositoryPath } from "@/store/paths.ts";
import { comparePathSuggestions, readPathEntrySuggestion } from "./path-suggestions.ts";
import type { InputSuggestion } from "./types.ts";

const IGNORED_COMPLETION_ENTRIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

export type RepoPathSuggestionsInput = {
  readonly repoRoot: string;
  readonly partial: string;
  readonly kind: "all" | "image";
  readonly limit: number;
};

export const listRepoPathSuggestions = async (
  input: RepoPathSuggestionsInput,
): Promise<InputSuggestion[]> => {
  const parts = parsePartialPath(input.partial);

  const isPartsMissing = parts === undefined;
  if (isPartsMissing) return [];

  const absoluteSearchDir = searchDirectory({
    dirPrefix: parts.dirPrefix,
    repoRoot: input.repoRoot,
  });

  const isAbsoluteSearchDirMissing = absoluteSearchDir === undefined;
  if (isAbsoluteSearchDirMissing) return [];

  return listMatchingEntries({ ...input, ...parts, absoluteSearchDir });
};

type PartialPathParts = {
  readonly dirPrefix: string;
  readonly namePrefix: string;
};

const parsePartialPath = (partial: string): PartialPathParts | undefined => {
  const normalized = partial.replaceAll("\\", "/").replaceAll(sep, "/");
  const isNormalizedAbsolutePath = normalized.startsWith("/");
  if (isNormalizedAbsolutePath) return undefined;

  const hasParentSegment = normalized.split("/").includes("..");
  if (hasParentSegment) return undefined;

  const slashIndex = normalized.lastIndexOf("/");
  const isSlashNotFound = slashIndex === -1;
  if (isSlashNotFound) {
    return { dirPrefix: "", namePrefix: normalized };
  }

  return {
    dirPrefix: normalized.slice(0, slashIndex),
    namePrefix: normalized.slice(slashIndex + 1),
  };
};

const searchDirectory = (input: {
  readonly dirPrefix: string;
  readonly repoRoot: string;
}): string | undefined => {
  try {
    const isDirPrefixEmpty = input.dirPrefix.length === 0;
    const relativeDir = isDirPrefixEmpty ? "." : input.dirPrefix;
    return readRepositoryPath(input.repoRoot, relativeDir);
  } catch {
    return undefined;
  }
};

type ListMatchingEntriesInput = RepoPathSuggestionsInput &
  PartialPathParts & {
    readonly absoluteSearchDir: string;
  };

const listMatchingEntries = async (input: ListMatchingEntriesInput): Promise<InputSuggestion[]> => {
  try {
    const entries = await readdir(input.absoluteSearchDir, { withFileTypes: true });
    return entries
      .filter((entry) => isCompletableEntry({ name: entry.name, namePrefix: input.namePrefix }))
      .filter((entry) => isMatchingKind({ entry, kind: input.kind, namePrefix: input.namePrefix }))
      .map((entry) => readPathEntrySuggestion(entry.name, input.dirPrefix, entry.isDirectory()))
      .sort(comparePathSuggestions)
      .slice(0, input.limit);
  } catch {
    return [];
  }
};

const isCompletableEntry = (input: {
  readonly name: string;
  readonly namePrefix: string;
}): boolean => {
  const isIgnoredEntry = IGNORED_COMPLETION_ENTRIES.has(input.name);
  if (isIgnoredEntry) return false;

  const isHiddenNamePrefix = input.namePrefix.startsWith(".");
  if (isHiddenNamePrefix) return true;

  return !input.name.startsWith(".");
};

const isMatchingKind = (input: {
  readonly entry: { name: string; isDirectory(): boolean; isFile(): boolean };
  readonly kind: "all" | "image";
  readonly namePrefix: string;
}): boolean => {
  const isSpecialFile = !input.entry.isDirectory() && !input.entry.isFile();
  if (isSpecialFile) return false;

  const isNotNameStartsWithNamePrefix = !input.entry.name.startsWith(input.namePrefix);
  if (isNotNameStartsWithNamePrefix) return false;

  const isDirectoryEntry = input.entry.isDirectory();
  if (isDirectoryEntry) return true;

  const isKindAll = input.kind === "all";
  if (isKindAll) return true;

  return IMAGE_EXTENSIONS.has(extname(input.entry.name).toLowerCase());
};
