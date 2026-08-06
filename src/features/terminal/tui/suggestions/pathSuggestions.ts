import { repoPathSuggestions } from "./repoPathSuggestions.ts";
import type {
  InputSuggestion,
  InputSuggestionGroup,
  LoadInputSuggestionsOptions,
} from "./types.ts";
import { suggestionLimit } from "./types.ts";

type PathSuggestionGroupInput = {
  readonly base: InputSuggestionGroup;
  readonly partial: string;
  readonly options: LoadInputSuggestionsOptions;
  readonly kind: "all" | "image";
};

export const pathSuggestionGroup = async (
  input: PathSuggestionGroupInput,
): Promise<InputSuggestionGroup> => {
  const limit = suggestionLimit(input.options.limit);
  const matches = await repoPathSuggestions({
    repoRoot: input.options.repoRoot,
    partial: input.partial,
    kind: input.kind,
    limit,
  });
  if (matches.length === 0) {
    return {
      ...input.base,
      suggestions: matches,
    };
  }
  return {
    ...input.base,
    suggestions: matches,
    hint: "Tab inserts the first path. Directories end with /.",
  };
};

export const pathEntrySuggestion = (
  name: string,
  dirPrefix: string,
  isDirectory: boolean,
): InputSuggestion => {
  const path = dirPrefix.length === 0 ? name : `${dirPrefix}/${name}`;
  if (isDirectory) {
    return {
      value: `${path}/`,
      label: `${path}/`,
      kind: "folder",
      detail: "folder",
    };
  }
  return {
    value: path,
    label: path,
    kind: "file",
  };
};

export const comparePathSuggestions = (left: InputSuggestion, right: InputSuggestion): number => {
  if (left.kind !== right.kind) {
    if (left.kind === "folder") return -1;
    if (right.kind === "folder") return 1;
  }
  return left.label.localeCompare(right.label);
};
