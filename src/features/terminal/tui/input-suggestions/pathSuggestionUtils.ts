import type { InputSuggestion } from "./types.ts";

/** Map one directory entry to an InputSuggestion. */
export function entryToSuggestion(
  name: string,
  dirPrefix: string,
  isDirectory: boolean,
): InputSuggestion {
  const path = dirPrefix ? `${dirPrefix}/${name}` : name;
  const value = isDirectory ? `${path}/` : path;
  return {
    value,
    label: value,
    kind: isDirectory ? "folder" : "file",
    detail: isDirectory ? "folder" : undefined,
  };
}

/** Sort folders before files, then alphabetically by label. */
export function comparePathSuggestions(left: InputSuggestion, right: InputSuggestion): number {
  if (left.kind !== right.kind) {
    if (left.kind === "folder") return -1;
    if (right.kind === "folder") return 1;
  }
  return left.label.localeCompare(right.label);
}
