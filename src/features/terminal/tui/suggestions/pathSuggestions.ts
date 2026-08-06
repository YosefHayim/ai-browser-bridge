import { repoPathSuggestions } from "./repoPathSuggestions.ts";
import type {
  InputSuggestion,
  InputSuggestionGroup,
  LoadInputSuggestionsOptions,
} from "./types.ts";
import { DEFAULT_SUGGESTION_LIMIT } from "./types.ts";

type PathSuggestionGroupInput = {
  base: InputSuggestionGroup;
  partial: string;
  options: LoadInputSuggestionsOptions;
  kind: "all" | "image";
};

export const pathSuggestionGroup = async (
  input: PathSuggestionGroupInput,
): Promise<InputSuggestionGroup> => {
  const limit = input.options.limit === undefined ? DEFAULT_SUGGESTION_LIMIT : input.options.limit;
  const matches = await repoPathSuggestions({
    repoRoot: input.options.repoRoot,
    partial: input.partial,
    kind: input.kind,
    limit,
  });
  return {
    ...input.base,
    suggestions: matches,
    hint:
      matches.length > 0 ? "Tab inserts the first path. Directories end with /." : input.base.hint,
  };
};

/** Map one directory entry to an InputSuggestion. */
export const pathEntrySuggestion = (
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

/** Sort folders before files, then alphabetically by label. */
export const comparePathSuggestions = (left: InputSuggestion, right: InputSuggestion): number => {
  if (left.kind !== right.kind) {
    if (left.kind === "folder") return -1;
    if (right.kind === "folder") return 1;
  }
  return left.label.localeCompare(right.label);
};
