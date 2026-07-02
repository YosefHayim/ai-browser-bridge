import { repoPathSuggestions } from "./repoPathSuggestions.ts";
import type { InputSuggestionGroup, LoadInputSuggestionsOptions } from "./types.ts";
import { DEFAULT_SUGGESTION_LIMIT } from "./types.ts";

/** Inputs for building a path suggestion group. */
interface PathSuggestionGroupParams {
  base: InputSuggestionGroup;
  partial: string;
  options: LoadInputSuggestionsOptions;
  kind: "all" | "image";
}

/** Build a suggestion group for repo path completion. */
export async function pathSuggestionGroup(
  params: PathSuggestionGroupParams,
): Promise<InputSuggestionGroup> {
  const limit = params.options.limit ?? DEFAULT_SUGGESTION_LIMIT;
  const matches = await repoPathSuggestions({
    repoRoot: params.options.repoRoot,
    partial: params.partial,
    kind: params.kind,
    limit,
  });
  return {
    ...params.base,
    suggestions: matches,
    hint:
      matches.length > 0 ? "Tab inserts the first path. Directories end with /." : params.base.hint,
  };
}
