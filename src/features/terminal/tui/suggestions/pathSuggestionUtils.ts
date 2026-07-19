import type { InputSuggestion } from "./types.ts";

/**
 * Map one directory entry to an InputSuggestion.
 *
 * @param name - Name value.
 * @param dirPrefix - Dir prefix value.
 * @param isDirectory - Is directory value.
 * @returns The `entryToSuggestion` result.
 * @example
 * ```ts
 * const result = entryToSuggestion(name, dirPrefix, isDirectory);
 * ```
 */
export const entryToSuggestion = (
  name: string,
  dirPrefix: string,
  isDirectory: boolean,
): InputSuggestion => {
  const path = dirPrefix ? `${dirPrefix}/${name}` : name;
  const value = isDirectory ? `${path}/` : path;
  return {
    value,
    label: value,
    kind: isDirectory ? "folder" : "file",
    detail: isDirectory ? "folder" : undefined,
  };
};

/**
 * Sort folders before files, then alphabetically by label.
 *
 * @param left - Left value.
 * @param right - Right value.
 * @returns The `comparePathSuggestions` result.
 * @example
 * ```ts
 * const result = comparePathSuggestions(left, right);
 * ```
 */
export const comparePathSuggestions = (left: InputSuggestion, right: InputSuggestion): number => {
  if (left.kind !== right.kind) {
    if (left.kind === "folder") return -1;
    if (right.kind === "folder") return 1;
  }
  return left.label.localeCompare(right.label);
};
