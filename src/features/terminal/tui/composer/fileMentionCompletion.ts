import { isAbsolute, sep } from "node:path";
import type { ActiveFileMention, FileCompletionMatch } from "./fileAutocompleteTypes.ts";

type FindMentionInput = {
  input: string;
  cursor?: number;
};

/** Find the active `@file` mention span before the cursor. */
export const findActiveFileMention = (input: FindMentionInput): ActiveFileMention | undefined => {
  const position = input.cursor === undefined ? input.input.length : input.cursor;
  return parseActiveFileMention({ text: input.input, position });
};

/** Parse an active `@file` mention ending at the cursor position. */
const parseActiveFileMention = (input: {
  text: string;
  position: number;
}): ActiveFileMention | undefined => {
  const beforeCursor = input.text.slice(0, input.position);
  const start = beforeCursor.lastIndexOf("@");
  if (start === -1 || !isMentionBoundary({ beforeCursor, start })) return undefined;
  return readMentionPartial({ start, beforeCursor, position: input.position });
};

/** Read the partial mention text when the span is valid. */
const readMentionPartial = (input: {
  start: number;
  beforeCursor: string;
  position: number;
}): ActiveFileMention | undefined => {
  const partial = input.beforeCursor.slice(input.start + 1);
  if (/\s/.test(partial)) return undefined;
  return { start: input.start, end: input.position, partial };
};

/** Whether `@` starts a new mention rather than appearing inside a token. */
const isMentionBoundary = (input: { beforeCursor: string; start: number }): boolean => {
  const previous = input.start > 0 ? input.beforeCursor[input.start - 1] : "";
  if (previous === undefined || previous === "") return true;
  return /\s/.test(previous);
};

/** Normalize path separators in a partial mention path. */
export const normalizePartialPath = (partial: string): string => {
  return partial.replaceAll("\\", "/").replaceAll(sep, "/");
};

/** Whether a partial mention path escapes the repo root. */
export const isUnsafePartial = (partial: string): boolean => {
  if (isAbsolute(partial) || partial.startsWith("/")) return true;
  return partial.split("/").filter(Boolean).includes("..");
};

/** Sort directories before files, then lexicographically by path. */
export const compareCompletionMatches = (
  left: FileCompletionMatch,
  right: FileCompletionMatch,
): number => {
  if (left.isDirectory !== right.isDirectory) {
    if (left.isDirectory) return -1;
    return 1;
  }
  return left.path.localeCompare(right.path);
};

/** Replace the active mention span with the chosen completion path. */
export const applyFileCompletion = (
  input: string,
  completion: { start: number; end: number; replacement: string },
): string => {
  return `${input.slice(0, completion.start + 1)}${completion.replacement}${input.slice(completion.end)}`;
};
