import { listRepoPathSuggestions } from "./repo-path-suggestions.ts";
import type {
  InputSuggestion,
  InputSuggestionGroup,
  LoadInputSuggestionsOptions,
} from "./types.ts";
import { readSuggestionLimit } from "./types.ts";

type PathSuggestionGroupInput = {
  readonly base: InputSuggestionGroup;
  readonly partial: string;
  readonly options: LoadInputSuggestionsOptions;
  readonly kind: "all" | "image";
};

export const readPathSuggestionGroup = async (
  input: PathSuggestionGroupInput,
): Promise<InputSuggestionGroup> => {
  const limit = readSuggestionLimit(input.options.limit);
  const matches = await listRepoPathSuggestions({
    repoRoot: input.options.repoRoot,
    partial: input.partial,
    kind: input.kind,
    limit,
  });

  const isMatchesEmpty = matches.length === 0;
  if (isMatchesEmpty) {
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

export const readPathEntrySuggestion = (
  name: string,
  dirPrefix: string,
  isDirectory: boolean,
): InputSuggestion => {
  const isDirPrefixEmpty = dirPrefix.length === 0;
  const path = isDirPrefixEmpty ? name : `${dirPrefix}/${name}`;

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
  const isKindDifferent = left.kind !== right.kind;
  if (isKindDifferent) {
    const isLeftKindFolder = left.kind === "folder";
    if (isLeftKindFolder) return -1;

    const isRightKindFolder = right.kind === "folder";
    if (isRightKindFolder) return 1;
  }

  return left.label.localeCompare(right.label);
};
