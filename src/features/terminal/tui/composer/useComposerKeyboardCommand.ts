import type { CommandDef } from "@/features/domain";
import {
  applyInputSuggestion,
  type InputSuggestionGroup,
} from "../suggestions/inputSuggestions.ts";
import type { ComposerKeyboardOptions } from "./composerKeyboardTypes.ts";
import type { ComposerState } from "./useComposerState.ts";

export const consumeCommandListKey = (
  options: ComposerKeyboardOptions & {
    char: string;
    key: { upArrow?: boolean; downArrow?: boolean; tab?: boolean; return?: boolean };
  },
): boolean => {
  const suggestions = commandListSuggestions(options.state);
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

const commandListSuggestions = (state: ComposerState): InputSuggestionGroup["suggestions"] => {
  if (state.inputSuggestions === undefined || state.inputSuggestions === null) return [];
  return state.inputSuggestions.suggestions;
};

const moveCommandSelectionUp = (state: ComposerState): boolean => {
  state.setSelectedIdx((index) => Math.max(0, index - 1));
  return true;
};

const moveCommandSelectionDown = (input: {
  state: ComposerState;
  suggestions: InputSuggestionGroup["suggestions"];
  matches: readonly CommandDef[];
}): boolean => {
  let listLength = input.matches.length;
  if (input.suggestions.length > 0) listLength = input.suggestions.length;
  const maxIndex = Math.max(0, listLength - 1);
  input.state.setSelectedIdx((index) => Math.min(maxIndex, index + 1));
  return true;
};

const completeCommandTab = (options: ComposerKeyboardOptions): boolean => {
  const suggestions = commandListSuggestions(options.state);
  if (suggestions.length > 0) completeSuggestionTab({ state: options.state, suggestions });
  else options.tabComplete();
  return true;
};

const completeSuggestionTab = (input: {
  state: ComposerState;
  suggestions: InputSuggestionGroup["suggestions"];
}): void => {
  const suggestionIndex = Math.min(input.state.selectedIdx, input.suggestions.length - 1);
  const suggestion = input.suggestions[suggestionIndex];
  if (suggestion === undefined) return;
  applySuggestionSelection({ state: input.state, suggestionIndex, label: suggestion.label });
};

const applySuggestionSelection = (input: {
  state: ComposerState;
  suggestionIndex: number;
  label: string;
}): void => {
  const suggestions = input.state.inputSuggestions;
  if (suggestions === null || suggestions === undefined) return;
  const nextInput = applyInputSuggestion(input.state.input, suggestions, input.suggestionIndex);
  input.state.setInput(nextInput);
  input.state.setMode("typing");
  input.state.setStatus(`Completed ${input.label}`);
};

const submitCommandSelection = (input: {
  options: ComposerKeyboardOptions;
  suggestions: InputSuggestionGroup["suggestions"];
}): boolean => {
  if (input.suggestions.length > 0) return submitSuggestionCommand(input);
  if (input.options.state.matches.length > 0) return submitMatchedCommand(input.options);
  return false;
};

const submitSuggestionCommand = (input: {
  options: ComposerKeyboardOptions;
  suggestions: InputSuggestionGroup["suggestions"];
}): boolean => {
  let suggestion = input.suggestions[input.options.state.selectedIdx];
  if (suggestion === undefined) suggestion = input.suggestions[0];
  if (suggestion === undefined) return false;
  resetCommandInput(input.options.state);
  void input.options.runCommand(suggestion.label);
  return true;
};

const submitMatchedCommand = (options: ComposerKeyboardOptions): boolean => {
  let command = options.state.matches[options.state.selectedIdx];
  if (command === undefined) command = options.state.matches[0];
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
