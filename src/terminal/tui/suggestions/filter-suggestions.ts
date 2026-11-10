import { COMMAND_SUGGESTION_RULES } from "./command-rules.ts";
import type { InputSuggestion, InputSuggestionGroup } from "./types.ts";
import { readSuggestionLimit } from "./types.ts";

type FilteredSuggestionsInput = {
  readonly group: InputSuggestionGroup;
  readonly suggestions: readonly InputSuggestion[];
  readonly query: string;
  readonly limit?: number;
};

export const filterSuggestionGroup = (input: FilteredSuggestionsInput): InputSuggestionGroup => {
  const normalizedQuery = input.query.toLowerCase();
  const limit = readSuggestionLimit(input.limit);
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

  const isSuggestionMissing = suggestion === undefined;
  if (isSuggestionMissing) return input;

  const isGroupReplacementStartMissing = group.replacementStart === undefined;
  if (isGroupReplacementStartMissing) return input;

  const isGroupReplacementEndMissing = group.replacementEnd === undefined;
  if (isGroupReplacementEndMissing) return input;

  return `${input.slice(0, group.replacementStart)}${suggestion.value}${input.slice(group.replacementEnd)}`;
};

export const listCommandSuggestionCoverage = (commands: readonly { name: string }[]): string[] => {
  return commands.map((command) => command.name).filter((name) => !COMMAND_SUGGESTION_RULES[name]);
};
