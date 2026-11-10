import { listRepoPathSuggestions } from "./repo-path-suggestions.ts";
import type {
  LoadPromptSuggestionsSettings,
  PromptSuggestion,
  PromptSuggestionGroup,
} from "./types.ts";
import { readSuggestionLimit } from "./types.ts";

type PathSuggestionGroupDetails = {
  readonly base: PromptSuggestionGroup;
  readonly partial: string;
  readonly options: LoadPromptSuggestionsSettings;
  readonly kind: "all" | "image";
};

export const readPathSuggestionGroup = async (
  details: PathSuggestionGroupDetails,
): Promise<PromptSuggestionGroup> => {
  const limit = readSuggestionLimit(details.options.limit);
  const hits = await listRepoPathSuggestions({
    repoRoot: details.options.repoRoot,
    partial: details.partial,
    kind: details.kind,
    limit,
  });

  const isHitsEmpty = hits.length === 0;
  if (isHitsEmpty) {
    return {
      ...details.base,
      suggestions: hits,
    };
  }

  return {
    ...details.base,
    suggestions: hits,
    hint: "Tab inserts the first path. Directories end with /.",
  };
};

export const readPathSuggestion = (
  name: string,
  dirPrefix: string,
  isDirectory: boolean,
): PromptSuggestion => {
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

export const comparePathSuggestions = (left: PromptSuggestion, right: PromptSuggestion): number => {
  const isKindDifferent = left.kind !== right.kind;
  if (isKindDifferent) {
    const isLeftKindFolder = left.kind === "folder";
    if (isLeftKindFolder) return -1;

    const isRightKindFolder = right.kind === "folder";
    if (isRightKindFolder) return 1;
  }

  return left.label.localeCompare(right.label);
};
