import { isAbsolute, sep } from "node:path";
import type { ActiveFileMention, FileCompletion } from "./file-autocomplete-types.ts";

type FindMentionDetails = {
  input: string;
  cursor?: number;
};

export const findActiveFileMention = (details: FindMentionDetails): ActiveFileMention | null => {
  const position = details.cursor == null ? details.input.length : details.cursor;
  return parseActiveFileMention({ text: details.input, position });
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
  const previous = isMentionNotAtStart ? details.beforeCursor[details.start - 1] : "";

  const isPreviousBlank = previous == null || previous === "";
  if (isPreviousBlank) return true;

  return /\s/.test(previous);
};

export const cleanPartialPath = (partial: string): string => {
  return partial.replaceAll("\\", "/").replaceAll(sep, "/");
};

export const isUnsafePartial = (partial: string): boolean => {
  const isAbsolutePath = isAbsolute(partial) || partial.startsWith("/");
  if (isAbsolutePath) return true;

  return partial.split("/").filter(Boolean).includes("..");
};

export const compareCompletionHits = (left: FileCompletion, right: FileCompletion): number => {
  const isDirectoryKindDifferent = left.isDirectory !== right.isDirectory;
  if (isDirectoryKindDifferent) {
    if (left.isDirectory) return -1;

    return 1;
  }

  return left.path.localeCompare(right.path);
};

export const applyFileCompletion = (
  prompt: string,
  completion: { start: number; end: number; replacement: string },
): string => {
  return `${prompt.slice(0, completion.start + 1)}${completion.replacement}${prompt.slice(completion.end)}`;
};
