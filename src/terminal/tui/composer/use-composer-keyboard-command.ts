import type { CommandDef } from "@/domain/command-types.ts";
import { applyInputSuggestion } from "@/terminal/tui/suggestions/filter-suggestions.ts";
import type { InputSuggestionGroup } from "@/terminal/tui/suggestions/types.ts";
import type { ComposerKeyboardOptions } from "./composer-keyboard-types.ts";
import type { ComposerState } from "./use-composer-state.ts";

export const consumeCommandListKey = (
  options: ComposerKeyboardOptions & {
    char: string;
    key: { upArrow?: boolean; downArrow?: boolean; tab?: boolean; return?: boolean };
  },
): boolean => {
  const suggestions = listCommandListSuggestions(options.state);

  if (options.key.upArrow) return moveCommandSelectionUp(options.state);

  if (options.key.downArrow) {
    return moveCommandSelectionDown({
      state: options.state,
      suggestions,
      matches: options.state.matches,
    });
  }

  if (options.key.tab) return completeCommandTab(options);

  if (options.key.return) return submitCommandSelection({ options, suggestions });

  return false;
};

const listCommandListSuggestions = (state: ComposerState): InputSuggestionGroup["suggestions"] => {
  if (state.inputSuggestions === undefined || state.inputSuggestions === null) return [];

  return state.inputSuggestions.suggestions;
};

const moveCommandSelectionUp = (state: ComposerState): boolean => {
  state.setSelectedIndex((index) => Math.max(0, index - 1));
  return true;
};

const moveCommandSelectionDown = (input: {
  state: ComposerState;
  suggestions: InputSuggestionGroup["suggestions"];
  matches: readonly CommandDef[];
}): boolean => {
  let listLength = input.matches.length;

  const isSuggestionsNotEmpty = input.suggestions.length > 0;
  if (isSuggestionsNotEmpty) listLength = input.suggestions.length;

  const maxIndex = Math.max(0, listLength - 1);
  input.state.setSelectedIndex((index) => Math.min(maxIndex, index + 1));
  return true;
};

const completeCommandTab = (options: ComposerKeyboardOptions): boolean => {
  const suggestions = listCommandListSuggestions(options.state);

  const hasSuggestions = suggestions.length > 0;
  if (hasSuggestions) completeSuggestionTab({ state: options.state, suggestions });
  else options.tabComplete();

  return true;
};

const completeSuggestionTab = (input: {
  state: ComposerState;
  suggestions: InputSuggestionGroup["suggestions"];
}): void => {
  const suggestionIndex = Math.min(input.state.selectedIndex, input.suggestions.length - 1);
  const suggestion = input.suggestions[suggestionIndex];

  const isSuggestionMissing = suggestion === undefined;
  if (isSuggestionMissing) return;

  applySuggestionSelection({ state: input.state, suggestionIndex, label: suggestion.label });
};

const applySuggestionSelection = (input: {
  state: ComposerState;
  suggestionIndex: number;
  label: string;
}): void => {
  const suggestions = input.state.inputSuggestions;
  const isSuggestionsMissing = suggestions === null || suggestions === undefined;
  if (isSuggestionsMissing) return;

  const nextInput = applyInputSuggestion(input.state.input, suggestions, input.suggestionIndex);
  input.state.setInput(nextInput);
  input.state.setMode("typing");
  input.state.setStatus(`Completed ${input.label}`);
};

const submitCommandSelection = (input: {
  options: ComposerKeyboardOptions;
  suggestions: InputSuggestionGroup["suggestions"];
}): boolean => {
  const isSuggestionsNotEmpty = input.suggestions.length > 0;
  if (isSuggestionsNotEmpty) return submitSuggestionCommand(input);

  const isMatchesNotEmpty = input.options.state.matches.length > 0;
  if (isMatchesNotEmpty) return submitMatchedCommand(input.options);

  return false;
};

const submitSuggestionCommand = (input: {
  options: ComposerKeyboardOptions;
  suggestions: InputSuggestionGroup["suggestions"];
}): boolean => {
  let suggestion = input.suggestions[input.options.state.selectedIndex];

  const isSuggestionMissing = suggestion === undefined;
  if (isSuggestionMissing) suggestion = input.suggestions[0];

  if (suggestion === undefined) return false;

  resetCommandInput(input.options.state);
  void input.options.runCommand(suggestion.label);
  return true;
};

const submitMatchedCommand = (options: ComposerKeyboardOptions): boolean => {
  let command = options.state.matches[options.state.selectedIndex];

  const isCommandMissing = command === undefined;
  if (isCommandMissing) command = options.state.matches[0];

  if (command === undefined) return false;

  resetCommandInput(options.state);
  void options.runCommand(`/${command.name}`);
  return true;
};

const resetCommandInput = (state: ComposerState): void => {
  state.refs.suppressNextSubmit.current = true;
  state.setInput("");
  state.setMode("typing");
};
