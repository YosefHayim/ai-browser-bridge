import type { Dirent } from "node:fs";
import { extname, sep } from "node:path";
import { comparePathSuggestions, readPathSuggestion } from "./path-suggestions.ts";
import { readSearchDirectoryEntries } from "./read-search-directory-entries.ts";
import type { PromptSuggestion } from "./types.ts";

const PATH_SEPARATOR = "/";
const HIDDEN_NAME_PREFIX = ".";

const IGNORED_COMPLETION_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

export type RepoPathSuggestionsDetails = {
  readonly repoRoot: string;
  readonly partial: string;
  readonly kind: "all" | "image";
  readonly limit: number;
};

export const listRepoPathSuggestions = async (
  details: RepoPathSuggestionsDetails,
): Promise<PromptSuggestion[]> => {
  const parts = parsePartialPath(details.partial);

  const isPartsMissing = parts == null;
  if (isPartsMissing) return [];

  const directoryEntries = await readSearchDirectoryEntries({
    repoRoot: details.repoRoot,
    directoryPrefix: parts.directoryPrefix,
  });

  return listMatchingNames({ ...details, ...parts, directoryEntries });
};

type PartialPathParts = {
  readonly directoryPrefix: string;
  readonly namePrefix: string;
};

const parsePartialPath = (partial: string): PartialPathParts | null => {
  const normalized = partial.replaceAll("\\", PATH_SEPARATOR).replaceAll(sep, PATH_SEPARATOR);

  const isNormalizedAbsolutePath = normalized.startsWith(PATH_SEPARATOR);
  if (isNormalizedAbsolutePath) return null;

  const hasParentSegment = normalized.split(PATH_SEPARATOR).includes("..");
  if (hasParentSegment) return null;

  const slashIndex = normalized.lastIndexOf(PATH_SEPARATOR);

  const isSlashNotFound = slashIndex === -1;
  if (isSlashNotFound) {
    return { directoryPrefix: "", namePrefix: normalized };
  }

  return {
    directoryPrefix: normalized.slice(0, slashIndex),
    namePrefix: normalized.slice(slashIndex + 1),
  };
};

type ListMatchingNamesDetails = RepoPathSuggestionsDetails &
  PartialPathParts & {
    readonly directoryEntries: Dirent[];
  };

const listMatchingNames = (details: ListMatchingNamesDetails): PromptSuggestion[] => {
  return details.directoryEntries
    .filter((dirent) => isCompletableName({ name: dirent.name, namePrefix: details.namePrefix }))
    .filter((dirent) =>
      isMatchingKind({ dirent, kind: details.kind, namePrefix: details.namePrefix }),
    )
    .map((dirent) => {
      const isDirectory = dirent.isDirectory();
      return readPathSuggestion(dirent.name, details.directoryPrefix, isDirectory);
    })
    .sort(comparePathSuggestions)
    .slice(0, details.limit);
};

const isCompletableName = (details: {
  readonly name: string;
  readonly namePrefix: string;
}): boolean => {
  const isIgnoredName = IGNORED_COMPLETION_NAMES.has(details.name);
  if (isIgnoredName) return false;

  const isHiddenNamePrefix = details.namePrefix.startsWith(HIDDEN_NAME_PREFIX);
  if (isHiddenNamePrefix) return true;

  return !details.name.startsWith(HIDDEN_NAME_PREFIX);
};

const isMatchingKind = (details: {
  readonly dirent: { name: string; isDirectory(): boolean; isFile(): boolean };
  readonly kind: "all" | "image";
  readonly namePrefix: string;
}): boolean => {
  const isSpecialFile = !details.dirent.isDirectory() && !details.dirent.isFile();
  if (isSpecialFile) return false;

  const isNotNameStartsWithNamePrefix = !details.dirent.name.startsWith(details.namePrefix);
  if (isNotNameStartsWithNamePrefix) return false;

  const isDirentDirectory = details.dirent.isDirectory();
  if (isDirentDirectory) return true;

  const isKindAll = details.kind === "all";
  if (isKindAll) return true;

  const lowerCaseExtension = extname(details.dirent.name).toLowerCase();
  return IMAGE_EXTENSIONS.has(lowerCaseExtension);
};
