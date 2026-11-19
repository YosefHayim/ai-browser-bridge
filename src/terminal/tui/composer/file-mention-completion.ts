import type { Dirent } from "node:fs";
import { isAbsolute, sep } from "node:path";
import { isBlankText } from "@/terminal/tui/shell/blank-text.ts";
import { readSearchDirectoryListing } from "@/terminal/tui/suggestions/read-search-directory-listing.ts";

const FORWARD_SLASH = "/";
const DEFAULT_COMPLETION_LIMIT = 20;

const IGNORED_COMPLETION_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
]);

export type ActiveFileMention = {
  readonly start: number;
  readonly end: number;
  readonly partial: string;
};

type FileCompletion = {
  readonly path: string;
  readonly isDirectory: boolean;
};

export type FileCompletionReport = ActiveFileMention & {
  readonly replacement: string;
  readonly matches: FileCompletion[];
};

export type FileCompletionSettings = {
  readonly limit?: number;
};

type FindMentionDetails = {
  promptDraft: string;
  cursor?: number;
};

export function findActiveFileMention(details: FindMentionDetails): ActiveFileMention | null {
  const { promptDraft, cursor } = details;

  const isCursorMissing = cursor == null;
  const position = isCursorMissing ? promptDraft.length : cursor;
  return parseActiveFileMention({ text: promptDraft, position });
}

function parseActiveFileMention(details: {
  text: string;
  position: number;
}): ActiveFileMention | null {
  const beforeCursor = details.text.slice(0, details.position);

  const start = beforeCursor.lastIndexOf("@");

  const isMentionNotFound = start === -1;
  if (isMentionNotFound) return null;

  const isNotMentionBoundary = !isMentionBoundary({ beforeCursor, start });
  if (isNotMentionBoundary) return null;

  return readMentionPartial({ start, beforeCursor, position: details.position });
}

function readMentionPartial(details: {
  start: number;
  beforeCursor: string;
  position: number;
}): ActiveFileMention | null {
  const partial = details.beforeCursor.slice(details.start + 1);

  const hasWhitespace = /\s/.test(partial);
  if (hasWhitespace) return null;

  return { start: details.start, end: details.position, partial };
}

function isMentionBoundary(details: { beforeCursor: string; start: number }): boolean {
  const isMentionNotAtStart = details.start > 0;
  const previousCharacter = isMentionNotAtStart ? details.beforeCursor[details.start - 1] : "";

  const isPreviousBlank = isBlankText(previousCharacter);
  if (isPreviousBlank) return true;

  return /\s/.test(previousCharacter);
}

function replacePathSeparatorsWithSlash(partial: string): string {
  return partial.replaceAll("\\", FORWARD_SLASH).replaceAll(sep, FORWARD_SLASH);
}

function isUnsafePartial(partial: string): boolean {
  const isAbsolutePath = isAbsolute(partial) || partial.startsWith(FORWARD_SLASH);
  if (isAbsolutePath) return true;

  return partial.split(FORWARD_SLASH).filter(Boolean).includes("..");
}

function compareCompletionHits(left: FileCompletion, right: FileCompletion): number {
  const isDirectoryKindDifferent = left.isDirectory !== right.isDirectory;

  const isLeftDirectoryFirst = isDirectoryKindDifferent && left.isDirectory;
  if (isLeftDirectoryFirst) return -1;

  if (isDirectoryKindDifferent) return 1;

  return left.path.localeCompare(right.path);
}

const HIDDEN_NAME_PREFIX = ".";

export async function completeFileMention(
  prompt: string,
  repoRoot: string,
  settings: FileCompletionSettings = {},
): Promise<FileCompletionReport | null> {
  const active = findActiveFileMention({ promptDraft: prompt });

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
}

async function readFileCompletion(details: {
  active: ActiveFileMention;
  partial: string;
  repoRoot: string;
  limit: number;
}): Promise<FileCompletionReport | null> {
  const hits = await findFileCompletions({
    partial: details.partial,
    repoRoot: details.repoRoot,
    limit: details.limit,
  });
  const best = hits[0];

  const isBestMissing = best == null;
  if (isBestMissing) return null;

  return { ...details.active, partial: details.partial, replacement: best.path, matches: hits };
}

type FindFileCompletionsDetails = {
  partial: string;
  repoRoot: string;
  limit: number;
};

async function findFileCompletions(details: FindFileCompletionsDetails): Promise<FileCompletion[]> {
  const parts = splitPartialPath(details.partial);
  const directoryListing = await readSearchDirectoryListing({
    repoRoot: details.repoRoot,
    directoryPrefix: parts.directoryPrefix,
  });

  return listCompletionHits({ ...details, ...parts, directoryListing: directoryListing });
}

function splitPartialPath(partial: string): { directoryPrefix: string; namePrefix: string } {
  const lastSlashIndex = partial.lastIndexOf("/");

  const isSlashNotFound = lastSlashIndex === -1;
  if (isSlashNotFound) {
    return { directoryPrefix: "", namePrefix: partial };
  }

  return {
    directoryPrefix: partial.slice(0, lastSlashIndex),
    namePrefix: partial.slice(lastSlashIndex + 1),
  };
}

function listCompletionHits(
  details: FindFileCompletionsDetails & {
    readonly directoryPrefix: string;
    readonly namePrefix: string;
    readonly directoryListing: Dirent[];
  },
): FileCompletion[] {
  const isHiddenNameWanted = details.namePrefix.startsWith(HIDDEN_NAME_PREFIX);

  return details.directoryListing
    .filter((dirent) => dirent.isDirectory() || dirent.isFile())
    .filter((dirent) => !IGNORED_COMPLETION_NAMES.has(dirent.name))
    .filter((dirent) => isHiddenNameWanted || !dirent.name.startsWith(HIDDEN_NAME_PREFIX))
    .filter((dirent) => dirent.name.startsWith(details.namePrefix))
    .map((dirent) => createFileCompletion({ dirent, directoryPrefix: details.directoryPrefix }))
    .sort((left, right) => compareCompletionHits(left, right))
    .slice(0, details.limit);
}

function createFileCompletion(details: {
  dirent: { name: string; isDirectory(): boolean };
  directoryPrefix: string;
}): FileCompletion {
  const isDirectoryPrefixEmpty = details.directoryPrefix === "";
  const directoryPrefixWithSlash = isDirectoryPrefixEmpty ? "" : `${details.directoryPrefix}/`;
  const relativePath = `${directoryPrefixWithSlash}${details.dirent.name}`;

  const isDirectoryDirent = details.dirent.isDirectory();
  if (isDirectoryDirent) {
    return { path: `${relativePath}/`, isDirectory: true };
  }

  return { path: relativePath, isDirectory: false };
}
