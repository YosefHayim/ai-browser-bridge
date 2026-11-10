import type { CommandDef } from "@/domain/command-types.ts";
import { applyPromptSuggestion } from "@/terminal/tui/suggestions/filter-suggestions.ts";
import type { PromptSuggestionGroup } from "@/terminal/tui/suggestions/types.ts";
import type { ComposerKeyboardSettings } from "./composer-keyboard-types.ts";
import type { ComposerStatus } from "./use-composer-state.ts";

export const consumeCommandListKey = (
  settings: ComposerKeyboardSettings & {
    char: string;
    key: { upArrow?: boolean; downArrow?: boolean; tab?: boolean; return?: boolean };
  },
): boolean => {
  const suggestions = listCommandListSuggestions(settings.state);

  if (settings.key.upArrow) return moveCommandSelectionUp(settings.state);

  if (settings.key.downArrow) {
    return moveCommandSelectionDown({
      state: settings.state,
      suggestions,
      matches: settings.state.matches,
    });
  }

  if (settings.key.tab) return completeCommandTab(settings);

  if (settings.key.return) return submitCommandSelection({ options: settings, suggestions });

  return false;
};

const listCommandListSuggestions = (
  status: ComposerStatus,
): PromptSuggestionGroup["suggestions"] => {
  if (status.inputSuggestions == null) return [];

  return status.inputSuggestions.suggestions;
};

const moveCommandSelectionUp = (status: ComposerStatus): boolean => {
  status.setSelectedIndex((index) => Math.max(0, index - 1));
  return true;
};

const moveCommandSelectionDown = (details: {
  state: ComposerStatus;
  suggestions: PromptSuggestionGroup["suggestions"];
  matches: readonly CommandDef[];
}): boolean => {
  let listLength = details.matches.length;

  const isSuggestionsNotEmpty = details.suggestions.length > 0;
  if (isSuggestionsNotEmpty) listLength = details.suggestions.length;

  const maxIndex = Math.max(0, listLength - 1);
  details.state.setSelectedIndex((index) => Math.min(maxIndex, index + 1));
  return true;
};

const completeCommandTab = (settings: ComposerKeyboardSettings): boolean => {
  const suggestions = listCommandListSuggestions(settings.state);

  const hasSuggestions = suggestions.length > 0;
  if (hasSuggestions) completeSuggestionTab({ state: settings.state, suggestions });
  else settings.tabComplete();

  return true;
};

const completeSuggestionTab = (details: {
  state: ComposerStatus;
  suggestions: PromptSuggestionGroup["suggestions"];
}): void => {
  const suggestionIndex = Math.min(details.state.selectedIndex, details.suggestions.length - 1);
  const suggestion = details.suggestions[suggestionIndex];

  const isSuggestionMissing = suggestion == null;
  if (isSuggestionMissing) return;

  applySuggestionSelection({ state: details.state, suggestionIndex, label: suggestion.label });
};

const applySuggestionSelection = (details: {
  state: ComposerStatus;
  suggestionIndex: number;
  label: string;
}): void => {
  const suggestions = details.state.inputSuggestions;
  const isSuggestionsMissing = suggestions == null;
  if (isSuggestionsMissing) return;

  const nextPrompt = applyPromptSuggestion(
    details.state.input,
    suggestions,
    details.suggestionIndex,
  );
  details.state.setInput(nextPrompt);
  details.state.setMode("typing");
  details.state.setStatus(`Completed ${details.label}`);
};

const submitCommandSelection = (details: {
  options: ComposerKeyboardSettings;
  suggestions: PromptSuggestionGroup["suggestions"];
}): boolean => {
  const isSuggestionsNotEmpty = details.suggestions.length > 0;
  if (isSuggestionsNotEmpty) return submitSuggestionCommand(details);

  const isHitsNotEmpty = details.options.state.matches.length > 0;
  if (isHitsNotEmpty) return submitMatchedCommand(details.options);

  return false;
};

const submitSuggestionCommand = (details: {
  options: ComposerKeyboardSettings;
  suggestions: PromptSuggestionGroup["suggestions"];
}): boolean => {
  let suggestion = details.suggestions[details.options.state.selectedIndex];

  const isSuggestionMissing = suggestion == null;
  if (isSuggestionMissing) suggestion = details.suggestions[0];

  if (suggestion == null) return false;

  resetCommandLine(details.options.state);
  void details.options.runCommand(suggestion.label);
  return true;
};

const submitMatchedCommand = (settings: ComposerKeyboardSettings): boolean => {
  let command = settings.state.matches[settings.state.selectedIndex];

  const isCommandMissing = command == null;
  if (isCommandMissing) command = settings.state.matches[0];

  if (command == null) return false;

  resetCommandLine(settings.state);
  void settings.runCommand(`/${command.name}`);
  return true;
};

const resetCommandLine = (status: ComposerStatus): void => {
  status.refs.suppressNextSubmit.current = true;
  status.setInput("");
  status.setMode("typing");
};
