import { readdir } from "node:fs/promises";
import { extname, sep } from "node:path";
import { ensureInsideRepo } from "../../../tools/server.ts";
import type { InputSuggestion } from "./types.ts";
import { comparePathSuggestions, entryToSuggestion } from "./path-suggestion-utils.ts";

const IGNORED_COMPLETION_ENTRIES = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".turbo"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

/** Inputs for listing repo path suggestions. */
export interface RepoPathSuggestionsParams {
  repoRoot: string;
  partial: string;
  kind: "all" | "image";
  limit: number;
}

/** List file and folder path suggestions under the repo root. */
export async function repoPathSuggestions(params: RepoPathSuggestionsParams): Promise<InputSuggestion[]> {
  const parts = parsePartialPath(params.partial);
  if (!parts) return [];
  const absoluteSearchDir = resolveSearchDir({ dirPrefix: parts.dirPrefix, repoRoot: params.repoRoot });
  if (!absoluteSearchDir) return [];
  return listMatchingEntries({ ...params, ...parts, absoluteSearchDir });
}

/** Parsed partial path components for repo completion. */
interface PartialPathParts {
  dirPrefix: string;
  namePrefix: string;
}

/** Parse a partial path into directory prefix and name prefix. */
function parsePartialPath(partial: string): PartialPathParts | null {
  const normalized = partial.replaceAll("\\", "/").replaceAll(sep, "/");
  if (normalized.startsWith("/") || normalized.split("/").includes("..")) return null;
  const slashIndex = normalized.lastIndexOf("/");
  return {
    dirPrefix: slashIndex === -1 ? "" : normalized.slice(0, slashIndex),
    namePrefix: slashIndex === -1 ? normalized : normalized.slice(slashIndex + 1),
  };
}

/** Resolve the absolute search directory inside the repo. */
function resolveSearchDir(input: { dirPrefix: string; repoRoot: string }): string | null {
  try {
    return ensureInsideRepo(input.dirPrefix || ".", input.repoRoot);
  } catch {
    return null;
  }
}

/** Inputs for listing directory entries matching a name prefix. */
interface ListMatchingEntriesParams extends RepoPathSuggestionsParams, PartialPathParts {
  absoluteSearchDir: string;
}

/** Read directory entries and map them to path suggestions. */
async function listMatchingEntries(params: ListMatchingEntriesParams): Promise<InputSuggestion[]> {
  try {
    const entries = await readdir(params.absoluteSearchDir, { withFileTypes: true });
    return entries
      .filter((entry) => isCompletableEntry({ name: entry.name, namePrefix: params.namePrefix }))
      .filter((entry) => matchesKind({ entry, kind: params.kind, namePrefix: params.namePrefix }))
      .map((entry) => entryToSuggestion(entry.name, params.dirPrefix, entry.isDirectory()))
      .sort((...args: [InputSuggestion, InputSuggestion]) => comparePathSuggestions(args[0], args[1]))
      .slice(0, params.limit);
  } catch {
    return [];
  }
}

/** Whether a directory entry should appear in completion results. */
function isCompletableEntry(input: { name: string; namePrefix: string }): boolean {
  if (IGNORED_COMPLETION_ENTRIES.has(input.name)) return false;
  return input.namePrefix.startsWith(".") || !input.name.startsWith(".");
}

/** Whether an entry matches the requested kind and name prefix. */
function matchesKind(input: {
  entry: { name: string; isDirectory(): boolean; isFile(): boolean };
  kind: "all" | "image";
  namePrefix: string;
}): boolean {
  if (!input.entry.isDirectory() && !input.entry.isFile()) return false;
  if (!input.entry.name.startsWith(input.namePrefix)) return false;
  if (input.entry.isDirectory()) return true;
  return input.kind === "all" || IMAGE_EXTENSIONS.has(extname(input.entry.name).toLowerCase());
}
