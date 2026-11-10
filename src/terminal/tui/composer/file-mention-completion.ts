import { isAbsolute, sep } from "node:path";
import type { ActiveFileMention, FileCompletion } from "./file-autocomplete-types.ts";

const FORWARD_SLASH = "/";

type FindMentionDetails = {
  input: string;
  cursor?: number;
};

export const findActiveFileMention = (details: FindMentionDetails): ActiveFileMention | null => {
  const { input, cursor } = details;

  const isCursorMissing = cursor == null;
  const position = isCursorMissing ? input.length : cursor;
  return parseActiveFileMention({ text: input, position });
};

const parseActiveFileMention = (details: {
  text: string;
  position: number;
}): ActiveFileMention | null => {
  const beforeCursor = details.text.slice(0, details.position);

  const start = beforeCursor.lastIndexOf("@");

  const isMentionNotFound = start === -1;
  if (isMentionNotFound) return null;

  const isNotMentionBoundary = !isMentionBoundary({ beforeCursor, start });
  if (isNotMentionBoundary) return null;

  return readMentionPartial({ start, beforeCursor, position: details.position });
};

const readMentionPartial = (details: {
  start: number;
  beforeCursor: string;
  position: number;
}): ActiveFileMention | null => {
  const partial = details.beforeCursor.slice(details.start + 1);

  const hasWhitespace = /\s/.test(partial);
  if (hasWhitespace) return null;

  return { start: details.start, end: details.position, partial };
};

const isMentionBoundary = (details: { beforeCursor: string; start: number }): boolean => {
  const isMentionNotAtStart = details.start > 0;
  const previousCharacter = isMentionNotAtStart ? details.beforeCursor[details.start - 1] : "";

  const isPreviousBlank = previousCharacter == null || previousCharacter === "";
  if (isPreviousBlank) return true;

  return /\s/.test(previousCharacter);
};

export const cleanPartialPath = (partial: string): string => {
  return partial.replaceAll("\\", FORWARD_SLASH).replaceAll(sep, FORWARD_SLASH);
};

export const isUnsafePartial = (partial: string): boolean => {
  const isAbsolutePath = isAbsolute(partial) || partial.startsWith(FORWARD_SLASH);
  if (isAbsolutePath) return true;

  return partial.split(FORWARD_SLASH).filter(Boolean).includes("..");
};

export const compareCompletionHits = (left: FileCompletion, right: FileCompletion): number => {
  const isDirectoryKindDifferent = left.isDirectory !== right.isDirectory;
  const isLeftDirectoryFirst = isDirectoryKindDifferent && left.isDirectory;
  if (isLeftDirectoryFirst) return -1;

  if (isDirectoryKindDifferent) return 1;

  return left.path.localeCompare(right.path);
};

export const applyFileCompletion = (
  prompt: string,
  completion: { start: number; end: number; replacement: string },
): string => {
  return `${prompt.slice(0, completion.start + 1)}${completion.replacement}${prompt.slice(completion.end)}`;
};
