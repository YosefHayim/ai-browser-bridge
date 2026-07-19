import { COMMAND_SUGGESTION_RULES } from "./commandRules.ts";
import type { InputSuggestion, InputSuggestionGroup } from "./types.ts";
import { DEFAULT_SUGGESTION_LIMIT } from "./types.ts";

/** Inputs for filtering suggestions by query prefix. */
interface WithFilteredSuggestionsParams {
  group: InputSuggestionGroup;
  suggestions: readonly InputSuggestion[];
  query: string;
  limit?: number;
}

/**
 * Filter suggestions by query and apply the limit.
 *
 * @param params - Params value.
 * @returns The `withFilteredSuggestions` result.
 * @example
 * ```ts
 * const result = withFilteredSuggestions(params);
 * ```
 */
export const withFilteredSuggestions = (
  params: WithFilteredSuggestionsParams,
): InputSuggestionGroup => {
  const normalizedQuery = params.query.toLowerCase();
  const limit = params.limit ?? DEFAULT_SUGGESTION_LIMIT;
  return {
    ...params.group,
    suggestions: params.suggestions
      .filter((suggestion) => suggestion.value.toLowerCase().includes(normalizedQuery))
      .slice(0, limit),
  };
};

/**
 * Apply a selected suggestion to the input string.
 *
 * @param input - Input values for the operation.
 * @param group - Group value.
 * @param index - Index value.
 * @returns The `applyInputSuggestion` result.
 * @example
 * ```ts
 * const result = applyInputSuggestion(input, group, index);
 * ```
 */
export const applyInputSuggestion = (
  input: string,
  group: InputSuggestionGroup,
  index = 0,
): string => {
  const suggestion = group.suggestions[index];
  if (!suggestion || group.replacementStart === undefined || group.replacementEnd === undefined)
    return input;
  return `${input.slice(0, group.replacementStart)}${suggestion.value}${input.slice(group.replacementEnd)}`;
};

/**
 * List built-in commands missing a suggestion rule entry.
 *
 * @param commands - Commands value.
 * @returns The `commandSuggestionCoverage` result.
 * @example
 * ```ts
 * const result = commandSuggestionCoverage(commands);
 * ```
 */
export const commandSuggestionCoverage = (commands: readonly { name: string }[]): string[] => {
  return commands.map((command) => command.name).filter((name) => !COMMAND_SUGGESTION_RULES[name]);
};
