import { COMMAND_SUGGESTION_RULES } from "./command-rules.ts";
import type { PromptSuggestion, PromptSuggestionGroup } from "./types.ts";
import { readSuggestionLimit } from "./types.ts";

type FilteredSuggestionsDetails = {
  readonly group: PromptSuggestionGroup;
  readonly suggestions: readonly PromptSuggestion[];
  readonly query: string;
  readonly limit?: number;
};

export const filterSuggestionGroup = (
  details: FilteredSuggestionsDetails,
): PromptSuggestionGroup => {
  const normalizedQuery = details.query.toLowerCase();
  const limit = readSuggestionLimit(details.limit);
  return {
    ...details.group,
    suggestions: details.suggestions
      .filter((suggestion) => suggestion.value.toLowerCase().includes(normalizedQuery))
      .slice(0, limit),
  };
};

export const applyPromptSuggestion = (
  details: string,
  group: PromptSuggestionGroup,
  index = 0,
): string => {
  const suggestion = group.suggestions[index];

  const isSuggestionMissing = suggestion == null;
  if (isSuggestionMissing) return details;

  const isGroupReplacementStartMissing = group.replacementStart == null;
  if (isGroupReplacementStartMissing) return details;

  const isGroupReplacementEndMissing = group.replacementEnd == null;
  if (isGroupReplacementEndMissing) return details;

  return `${details.slice(0, group.replacementStart)}${suggestion.value}${details.slice(group.replacementEnd)}`;
};

export const listCommandSuggestionCoverage = (commands: readonly { name: string }[]): string[] => {
  return commands.map((command) => command.name).filter((name) => !COMMAND_SUGGESTION_RULES[name]);
};
