import type { CommandDef } from "../../domain/types.ts";
import type { ComposerKeyboardOptions } from "./composerKeyboardTypes.ts";
import { type InputSuggestionGroup, applyInputSuggestion } from "./inputSuggestions.ts";
import type { ComposerState } from "./useComposerState.ts";

export function handleCommandListKeys(
  options: ComposerKeyboardOptions & {
    char: string;
    key: { upArrow?: boolean; downArrow?: boolean; tab?: boolean; return?: boolean };
  },
) {
  const suggestions = options.state.inputSuggestions?.suggestions ?? [];
  if (options.key.upArrow) return moveCommandSelectionUp(options.state);
  if (options.key.downArrow) {
    return moveCommandSelectionDown({
      state: options.state,
      suggestions,
      matches: options.state.matches,
    });
  }
  if (options.key.tab) return completeCommandTab(options);
  return options.key.return ? submitCommandSelection({ options, suggestions }) : false;
}

function moveCommandSelectionUp(state: ComposerState) {
  state.setSelectedIdx((index) => Math.max(0, index - 1));
  return true;
}

function moveCommandSelectionDown(input: {
  state: ComposerState;
  suggestions: InputSuggestionGroup["suggestions"];
  matches: readonly CommandDef[];
}) {
  const maxIndex = Math.max(0, (input.suggestions.length || input.matches.length) - 1);
  input.state.setSelectedIdx((index) => Math.min(maxIndex, index + 1));
  return true;
}

function completeCommandTab(options: ComposerKeyboardOptions) {
  const suggestions = options.state.inputSuggestions?.suggestions ?? [];
  if (suggestions.length) completeSuggestionTab({ state: options.state, suggestions });
  else options.tabComplete();
  return true;
}

function completeSuggestionTab(input: {
  state: ComposerState;
  suggestions: InputSuggestionGroup["suggestions"];
}) {
  const suggestionIndex = Math.min(input.state.selectedIdx, input.suggestions.length - 1);
  const suggestion = input.suggestions[suggestionIndex] ?? input.suggestions[0];
  if (!suggestion) return;
  applySuggestionSelection({ state: input.state, suggestionIndex, label: suggestion.label });
}

/** Apply one selected suggestion to the composer input. */
function applySuggestionSelection(input: {
  state: ComposerState;
  suggestionIndex: number;
  label: string;
}): void {
  const suggestions = input.state.inputSuggestions;
  if (!suggestions) return;
  const nextInput = applyInputSuggestion(input.state.input, suggestions, input.suggestionIndex);
  input.state.setInput(nextInput);
  input.state.setMode("typing");
  input.state.setStatus(`Completed ${input.label}`);
}

function submitCommandSelection(input: {
  options: ComposerKeyboardOptions;
  suggestions: InputSuggestionGroup["suggestions"];
}): boolean {
  if (input.suggestions.length > 0) return submitSuggestionCommand(input);
  if (input.options.state.matches.length > 0) return submitMatchedCommand(input.options);
  return false;
}

function submitSuggestionCommand(input: {
  options: ComposerKeyboardOptions;
  suggestions: InputSuggestionGroup["suggestions"];
}) {
  const suggestion = input.suggestions[input.options.state.selectedIdx] ?? input.suggestions[0];
  if (!suggestion) return false;
  resetCommandInput(input.options.state);
  void input.options.runCommand(suggestion.label);
  return true;
}

function submitMatchedCommand(options: ComposerKeyboardOptions) {
  const cmd = options.state.matches[options.state.selectedIdx] ?? options.state.matches[0];
  if (!cmd) return false;
  resetCommandInput(options.state);
  void options.runCommand(`/${cmd.name}`);
  return true;
}

/** Clear composer input after choosing a command from the menu. */
function resetCommandInput(state: ComposerState): void {
  state.refs.suppressNextSubmit.current = true;
  state.setInput("");
  state.setMode("typing");
}
