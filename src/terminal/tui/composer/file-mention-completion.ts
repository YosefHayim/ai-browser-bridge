import { isAbsolute, sep } from "node:path";
import type { ActiveFileMention, FileCompletionMatch } from "./file-autocomplete-types.ts";

type FindMentionInput = {
  input: string;
  cursor?: number;
};

export const findActiveFileMention = (input: FindMentionInput): ActiveFileMention | undefined => {
  const position = input.cursor === undefined ? input.input.length : input.cursor;
  return parseActiveFileMention({ text: input.input, position });
};

const parseActiveFileMention = (input: {
  text: string;
  position: number;
}): ActiveFileMention | undefined => {
  const beforeCursor = input.text.slice(0, input.position);

  const start = beforeCursor.lastIndexOf("@");
  const isMentionNotFound = start === -1;
  if (isMentionNotFound) return undefined;

  const isNotMentionBoundary = !isMentionBoundary({ beforeCursor, start });
  if (isNotMentionBoundary) return undefined;

  return readMentionPartial({ start, beforeCursor, position: input.position });
};

const readMentionPartial = (input: {
  start: number;
  beforeCursor: string;
  position: number;
}): ActiveFileMention | undefined => {
  const partial = input.beforeCursor.slice(input.start + 1);
  const hasWhitespace = /\s/.test(partial);
  if (hasWhitespace) return undefined;

  return { start: input.start, end: input.position, partial };
};

const isMentionBoundary = (input: { beforeCursor: string; start: number }): boolean => {
  const isMentionNotAtStart = input.start > 0;
  const previous = isMentionNotAtStart ? input.beforeCursor[input.start - 1] : "";
  const isPreviousBlank = previous === undefined || previous === "";
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

export const compareCompletionMatches = (
  left: FileCompletionMatch,
  right: FileCompletionMatch,
): number => {
  const isDirectoryKindDifferent = left.isDirectory !== right.isDirectory;
  if (isDirectoryKindDifferent) {
    if (left.isDirectory) return -1;

    return 1;
  }

  return left.path.localeCompare(right.path);
};

export const applyFileCompletion = (
  input: string,
  completion: { start: number; end: number; replacement: string },
): string => {
  return `${input.slice(0, completion.start + 1)}${completion.replacement}${input.slice(completion.end)}`;
};
