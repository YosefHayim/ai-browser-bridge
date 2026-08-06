import { isAbsolute, sep } from "node:path";
import type { ActiveFileMention, FileCompletionMatch } from "./fileAutocompleteTypes.ts";

interface FindMentionInput {
  /** Full composer input text. */
  input: string;
  /** Cursor position within the input. */
  cursor?: number;
}

/**
 * Find the active `@file` mention span before the cursor.
 *
 * @param input - Input values for the operation.
 * @param cursor - Cursor value.
 * @returns The `findActiveFileMention` result.
 * @example
 * ```ts
 * const result = findActiveFileMention(input, cursor);
 * ```
 */
export const findActiveFileMention = (
  input: FindMentionInput | string,
  cursor?: number,
): ActiveFileMention | null => {
  const text = typeof input === "string" ? input : input.input;
  const position =
    typeof input === "string" ? (cursor ?? text.length) : (input.cursor ?? text.length);
  return parseActiveFileMention({ text, position });
};

/** Parse an active `@file` mention ending at the cursor position. */
const parseActiveFileMention = (input: {
  text: string;
  position: number;
}): ActiveFileMention | null => {
  const beforeCursor = input.text.slice(0, input.position);
  const start = beforeCursor.lastIndexOf("@");
  if (start === -1 || !isMentionBoundary({ beforeCursor, start })) return null;
  return readMentionPartial({ start, beforeCursor, position: input.position });
};

/** Read the partial mention text when the span is valid. */
const readMentionPartial = (input: {
  start: number;
  beforeCursor: string;
  position: number;
}): ActiveFileMention | null => {
  const partial = input.beforeCursor.slice(input.start + 1);
  if (/\s/.test(partial)) return null;
  return { start: input.start, end: input.position, partial };
};

/** Whether `@` starts a new mention rather than appearing inside a token. */
const isMentionBoundary = (input: { beforeCursor: string; start: number }): boolean => {
  const previous = input.start > 0 ? input.beforeCursor[input.start - 1] : "";
  return !previous || /\s/.test(previous);
};

/**
 * Normalize path separators in a partial mention path.
 *
 * @param partial - Partial value.
 * @returns The `normalizePartialPath` result.
 * @example
 * ```ts
 * const result = normalizePartialPath(partial);
 * ```
 */
export const normalizePartialPath = (partial: string): string => {
  return partial.replaceAll("\\", "/").replaceAll(sep, "/");
};

/**
 * Whether a partial mention path escapes the repo root.
 *
 * @param partial - Partial value.
 * @returns Whether the condition matches.
 * @example
 * ```ts
 * const result = isUnsafePartial(partial);
 * ```
 */
export const isUnsafePartial = (partial: string): boolean => {
  if (isAbsolute(partial) || partial.startsWith("/")) return true;
  return partial.split("/").filter(Boolean).includes("..");
};

/**
 * Sort directories before files, then lexicographically by path.
 *
 * @param left - Left value.
 * @param right - Right value.
 * @returns The `compareCompletionMatches` result.
 * @example
 * ```ts
 * const result = compareCompletionMatches(left, right);
 * ```
 */
export const compareCompletionMatches = (
  left: FileCompletionMatch,
  right: FileCompletionMatch,
): number => {
  if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
  return left.path.localeCompare(right.path);
};

/**
 * Replace the active mention span with the chosen completion path.
 *
 * @param input - Input values for the operation.
 * @param completion - Completion value.
 * @returns The `applyFileCompletion` result.
 * @example
 * ```ts
 * const result = applyFileCompletion(input, completion);
 * ```
 */
export const applyFileCompletion = (
  input: string,
  completion: { start: number; end: number; replacement: string },
): string => {
  return `${input.slice(0, completion.start + 1)}${completion.replacement}${input.slice(completion.end)}`;
};
