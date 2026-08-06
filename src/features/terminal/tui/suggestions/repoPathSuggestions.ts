import { readdir } from "node:fs/promises";
import { extname, sep } from "node:path";
import { repositoryPath } from "@/features/store";
import { comparePathSuggestions, pathEntrySuggestion } from "./pathSuggestions.ts";
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

export const repoPathSuggestions = async (
  input: RepoPathSuggestionsInput,
): Promise<InputSuggestion[]> => {
  const parts = parsePartialPath(input.partial);
  if (parts === undefined) return [];
  const absoluteSearchDir = searchDirectory({
    dirPrefix: parts.dirPrefix,
    repoRoot: input.repoRoot,
  });
  if (absoluteSearchDir === undefined) return [];
  return listMatchingEntries({ ...input, ...parts, absoluteSearchDir });
};

type PartialPathParts = {
  readonly dirPrefix: string;
  readonly namePrefix: string;
};

const parsePartialPath = (partial: string): PartialPathParts | undefined => {
  const normalized = partial.replaceAll("\\", "/").replaceAll(sep, "/");
  if (normalized.startsWith("/")) return undefined;
  if (normalized.split("/").includes("..")) return undefined;
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex === -1) {
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
    const relativeDir = input.dirPrefix.length === 0 ? "." : input.dirPrefix;
    return repositoryPath(input.repoRoot, relativeDir);
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
      .filter((entry) => matchesKind({ entry, kind: input.kind, namePrefix: input.namePrefix }))
      .map((entry) => pathEntrySuggestion(entry.name, input.dirPrefix, entry.isDirectory()))
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
  if (IGNORED_COMPLETION_ENTRIES.has(input.name)) return false;
  if (input.namePrefix.startsWith(".")) return true;
  return !input.name.startsWith(".");
};

const matchesKind = (input: {
  readonly entry: { name: string; isDirectory(): boolean; isFile(): boolean };
  readonly kind: "all" | "image";
  readonly namePrefix: string;
}): boolean => {
  if (!input.entry.isDirectory() && !input.entry.isFile()) return false;
  if (!input.entry.name.startsWith(input.namePrefix)) return false;
  if (input.entry.isDirectory()) return true;
  if (input.kind === "all") return true;
  return IMAGE_EXTENSIONS.has(extname(input.entry.name).toLowerCase());
};
