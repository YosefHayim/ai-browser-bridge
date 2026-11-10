import { readdir } from "node:fs/promises";
import { readRepositoryPath } from "@/store/paths.ts";
import {
  type ActiveFileMention,
  DEFAULT_COMPLETION_LIMIT,
  type FileCompletion,
  type FileCompletionReport,
  type FileCompletionSettings,
  IGNORED_COMPLETION_NAMES,
} from "./file-autocomplete-types.ts";
import {
  compareCompletionHits,
  findActiveFileMention,
  isUnsafePartial,
  replacePathSeparatorsWithSlash,
} from "./file-mention-completion.ts";

const HIDDEN_NAME_PREFIX = ".";

export const completeFileMention = async (
  prompt: string,
  repoRoot: string,
  settings: FileCompletionSettings = {},
): Promise<FileCompletionReport | null> => {
  const active = findActiveFileMention({ input: prompt });

  const isActiveMissing = active == null;
  if (isActiveMissing) return null;

  const partial = replacePathSeparatorsWithSlash(active.partial);
  if (isUnsafePartial(partial)) return null;

  const { limit: requestedLimit } = settings;
  const isLimitMissing = requestedLimit == null;
  const limit = isLimitMissing ? DEFAULT_COMPLETION_LIMIT : requestedLimit;

  return readFileCompletion({
    active,
    partial,
    repoRoot,
    limit,
  });
};

const readFileCompletion = async (details: {
  active: ActiveFileMention;
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
  const isHiddenNameWanted = details.namePrefix.startsWith(HIDDEN_NAME_PREFIX);

  try {
    const dirents = await readdir(details.absoluteSearchDir, { withFileTypes: true });
    return dirents
      .filter((dirent) => dirent.isDirectory() || dirent.isFile())
      .filter((dirent) => !IGNORED_COMPLETION_NAMES.has(dirent.name))
      .filter((dirent) => isHiddenNameWanted || !dirent.name.startsWith(HIDDEN_NAME_PREFIX))
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
  const dirPrefixWithSlash = isDirPrefixEmpty ? "" : `${details.dirPrefix}/`;
  const relativePath = `${dirPrefixWithSlash}${details.dirent.name}`;

  const isDirectoryDirent = details.dirent.isDirectory();
  if (isDirectoryDirent) {
    return { path: `${relativePath}/`, isDirectory: true };
  }

  return { path: relativePath, isDirectory: false };
};
