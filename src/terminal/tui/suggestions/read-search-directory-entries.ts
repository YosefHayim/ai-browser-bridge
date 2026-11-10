import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { readRepositoryPath } from "@/store/paths.ts";

export const readSearchDirectoryEntries = async (details: {
  readonly repoRoot: string;
  readonly directoryPrefix: string;
}): Promise<Dirent[]> => {
  const absoluteDirectory = findAbsoluteDirectory(details);

  const isDirectoryMissing = absoluteDirectory == null;
  if (isDirectoryMissing) return [];

  return listDirectoryEntries(absoluteDirectory);
};

const findAbsoluteDirectory = (details: {
  readonly repoRoot: string;
  readonly directoryPrefix: string;
}): string | null => {
  const isDirectoryPrefixEmpty = details.directoryPrefix === "";
  const relativeDirectory = isDirectoryPrefixEmpty ? "." : details.directoryPrefix;

  try {
    return readRepositoryPath(details.repoRoot, relativeDirectory);
  } catch (error) {
    const isUnexpectedError = !isMissingPathError(error);
    if (isUnexpectedError) console.error({ error });

    return null;
  }
};

const listDirectoryEntries = async (absoluteDirectory: string): Promise<Dirent[]> => {
  try {
    return await readdir(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    const isUnexpectedError = !isMissingPathError(error);
    if (isUnexpectedError) console.error({ error });

    return [];
  }
};

const isMissingPathError = (error: unknown): boolean => {
  const isPathOutsideRepo =
    error instanceof Error && error.message.startsWith("Path escapes repo root");
  if (isPathOutsideRepo) return true;

  const isMissingEntry =
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR");
  return isMissingEntry;
};
