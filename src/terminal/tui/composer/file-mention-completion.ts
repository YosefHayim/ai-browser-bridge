import { isAbsolute, sep } from "node:path";
import type {
  ActiveFileMention,
  FileCompletion,
} from "@/terminal/tui/composer/file-autocomplete-types.ts";

const FORWARD_SLASH = "/";

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

  const isPreviousBlank = previousCharacter == null || previousCharacter === "";
  if (isPreviousBlank) return true;

  return /\s/.test(previousCharacter);
}

export function replacePathSeparatorsWithSlash(partial: string): string {
  return partial.replaceAll("\\", FORWARD_SLASH).replaceAll(sep, FORWARD_SLASH);
}

export function isUnsafePartial(partial: string): boolean {
  const isAbsolutePath = isAbsolute(partial) || partial.startsWith(FORWARD_SLASH);
  if (isAbsolutePath) return true;

  return partial.split(FORWARD_SLASH).filter(Boolean).includes("..");
}

export function compareCompletionHits(left: FileCompletion, right: FileCompletion): number {
  const isDirectoryKindDifferent = left.isDirectory !== right.isDirectory;

  const isLeftDirectoryFirst = isDirectoryKindDifferent && left.isDirectory;
  if (isLeftDirectoryFirst) return -1;

  if (isDirectoryKindDifferent) return 1;

  return left.path.localeCompare(right.path);
}
