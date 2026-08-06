import { COMMAND_SUGGESTION_RULES } from "./commandRules.ts";
import type { InputSuggestion, InputSuggestionGroup } from "./types.ts";
import { suggestionLimit } from "./types.ts";

type FilteredSuggestionsInput = {
  readonly group: InputSuggestionGroup;
  readonly suggestions: readonly InputSuggestion[];
  readonly query: string;
  readonly limit?: number;
};

export const withFilteredSuggestions = (input: FilteredSuggestionsInput): InputSuggestionGroup => {
  const normalizedQuery = input.query.toLowerCase();
  const limit = suggestionLimit(input.limit);
  return {
    ...input.group,
    suggestions: input.suggestions
      .filter((suggestion) => suggestion.value.toLowerCase().includes(normalizedQuery))
      .slice(0, limit),
  };
};

export const applyInputSuggestion = (
  input: string,
  group: InputSuggestionGroup,
  index = 0,
): string => {
  const suggestion = group.suggestions[index];
  if (suggestion === undefined) return input;
  if (group.replacementStart === undefined) return input;
  if (group.replacementEnd === undefined) return input;
  return `${input.slice(0, group.replacementStart)}${suggestion.value}${input.slice(group.replacementEnd)}`;
};

export const commandSuggestionCoverage = (commands: readonly { name: string }[]): string[] => {
  return commands.map((command) => command.name).filter((name) => !COMMAND_SUGGESTION_RULES[name]);
};
