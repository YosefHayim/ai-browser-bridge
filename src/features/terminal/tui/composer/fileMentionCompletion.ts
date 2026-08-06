import { isAbsolute, sep } from "node:path";
import type { ActiveFileMention, FileCompletionMatch } from "./fileAutocompleteTypes.ts";

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
  if (start === -1) return undefined;
  if (!isMentionBoundary({ beforeCursor, start })) return undefined;
  return readMentionPartial({ start, beforeCursor, position: input.position });
};

const readMentionPartial = (input: {
  start: number;
  beforeCursor: string;
  position: number;
}): ActiveFileMention | undefined => {
  const partial = input.beforeCursor.slice(input.start + 1);
  if (/\s/.test(partial)) return undefined;
  return { start: input.start, end: input.position, partial };
};

const isMentionBoundary = (input: { beforeCursor: string; start: number }): boolean => {
  const previous = input.start > 0 ? input.beforeCursor[input.start - 1] : "";
  if (previous === undefined || previous === "") return true;
  return /\s/.test(previous);
};

export const normalizePartialPath = (partial: string): string => {
  return partial.replaceAll("\\", "/").replaceAll(sep, "/");
};

export const isUnsafePartial = (partial: string): boolean => {
  if (isAbsolute(partial) || partial.startsWith("/")) return true;
  return partial.split("/").filter(Boolean).includes("..");
};

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

export const applyFileCompletion = (
  input: string,
  completion: { start: number; end: number; replacement: string },
): string => {
  return `${input.slice(0, completion.start + 1)}${completion.replacement}${input.slice(completion.end)}`;
};
