import { readdir } from "node:fs/promises";
import { readRepositoryPath } from "@/store/paths.ts";
import {
  DEFAULT_COMPLETION_LIMIT,
  type FileCompletion,
  type FileCompletionReport,
  type FileCompletionSettings,
  IGNORED_COMPLETION_NAMES,
} from "./file-autocomplete-types.ts";
import {
  cleanPartialPath,
  compareCompletionHits,
  findActiveFileMention,
  isUnsafePartial,
} from "./file-mention-completion.ts";

export const completeFileMention = async (
  prompt: string,
  repoRoot: string,
  settings: FileCompletionSettings = {},
): Promise<FileCompletionReport | null> => {
  const active = findActiveFileMention({ input: prompt });

  const isActiveMissing = active == null;
  if (isActiveMissing) return null;

  const partial = cleanPartialPath(active.partial);
  if (isUnsafePartial(partial)) return null;

  const limit = settings.limit == null ? DEFAULT_COMPLETION_LIMIT : settings.limit;
  return readFileCompletion({
    active,
    partial,
    repoRoot,
    limit,
  });
};

const readFileCompletion = async (details: {
  active: NonNullable<ReturnType<typeof findActiveFileMention>>;
  partial: string;
  repoRoot: string;
  limit: number;
}): Promise<FileCompletionReport | null> => {
  const hits = await findFileCompletions({
    partial: details.partial,
    repoRoot: details.repoRoot,
    limit: details.limit,
  });
  const best = hits[0];

  const isBestMissing = best == null;
  if (isBestMissing) return null;

  return { ...details.active, partial: details.partial, replacement: best.path, matches: hits };
};

type FindFileCompletionsDetails = {
  partial: string;
  repoRoot: string;
  limit: number;
};

const findFileCompletions = async (
  details: FindFileCompletionsDetails,
): Promise<FileCompletion[]> => {
  const parts = splitPartialPath(details.partial);
  const absoluteSearchDir = readCompletionSearchDirectory({
    dirPrefix: parts.dirPrefix,
    repoRoot: details.repoRoot,
  });

  const isAbsoluteSearchDirMissing = absoluteSearchDir == null;
  if (isAbsoluteSearchDirMissing) return [];

  return readCompletionHits({ ...details, ...parts, absoluteSearchDir });
};

const splitPartialPath = (partial: string): { dirPrefix: string; namePrefix: string } => {
  const lastSlashIndex = partial.lastIndexOf("/");

  const isSlashNotFound = lastSlashIndex === -1;
  if (isSlashNotFound) {
    return { dirPrefix: "", namePrefix: partial };
  }

  return {
    dirPrefix: partial.slice(0, lastSlashIndex),
    namePrefix: partial.slice(lastSlashIndex + 1),
  };
};

const readCompletionSearchDirectory = (details: {
  dirPrefix: string;
  repoRoot: string;
}): string | null => {
  const isDirPrefixEmpty = details.dirPrefix === "";
  const relativeDir = isDirPrefixEmpty ? "." : details.dirPrefix;

  try {
    return readRepositoryPath(details.repoRoot, relativeDir);
  } catch {
    return null;
  }
};

const readCompletionHits = async (
  details: FindFileCompletionsDetails & {
    dirPrefix: string;
    namePrefix: string;
    absoluteSearchDir: string;
  },
): Promise<FileCompletion[]> => {
  try {
    const dirents = await readdir(details.absoluteSearchDir, { withFileTypes: true });
    return dirents
      .filter((dirent) => dirent.isDirectory() || dirent.isFile())
      .filter((dirent) => !IGNORED_COMPLETION_NAMES.has(dirent.name))
      .filter((dirent) => details.namePrefix.startsWith(".") || !dirent.name.startsWith("."))
      .filter((dirent) => dirent.name.startsWith(details.namePrefix))
      .map((dirent) => createFileCompletion({ dirent, dirPrefix: details.dirPrefix }))
      .sort((left, right) => compareCompletionHits(left, right))
      .slice(0, details.limit);
  } catch {
    return [];
  }
};

const createFileCompletion = (details: {
  dirent: { name: string; isDirectory(): boolean };
  dirPrefix: string;
}): FileCompletion => {
  const isDirPrefixEmpty = details.dirPrefix === "";
  const relativePath = isDirPrefixEmpty
    ? details.dirent.name
    : `${details.dirPrefix}/${details.dirent.name}`;

  const isDirectoryDirent = details.dirent.isDirectory();
  if (isDirectoryDirent) {
    return { path: `${relativePath}/`, isDirectory: true };
  }

  return { path: relativePath, isDirectory: false };
};
