import { applyInputSuggestion } from "@/terminal/tui/suggestions/filter-suggestions.ts";
import { reverseHistoryMatch } from "./composer-history.ts";
import type { ComposerKeyboardOptions } from "./composer-keyboard-types.ts";
import type { ComposerState } from "./use-composer-state.ts";

export const consumeGlobalShortcut = (options: {
  char: string;
  key: { ctrl?: boolean };
  exit: () => void;
  state: ComposerState;
}): boolean => {
  if (options.key.ctrl && options.char === "c") {
    options.exit();
    return true;
  }

  if (options.key.ctrl && (options.char === "r" || options.char === "\u0012")) {
    applyHistoryMatch(options.state);
    return true;
  }

  return false;
};

const applyHistoryMatch = (state: ComposerState): void => {
  const historyPrompt = reverseHistoryMatch(state.refs.history.current.listPrompts(), state.input);
  const isMatchMissing = historyPrompt === undefined;
  if (isMatchMissing) {
    state.setStatus(`No history match for "${state.input}"`);
    return;
  }

  state.setInput(historyPrompt);
  state.setStatus(`History match: ${historyPrompt}`);
};

export const consumeTypingKey = (
  options: ComposerKeyboardOptions & {
    char: string;
    key: { upArrow?: boolean; downArrow?: boolean; tab?: boolean };
  },
): void => {
  if (options.key.upArrow) {
    options.state.setInput(
      options.state.refs.history.current.readPreviousPrompt(options.state.input),
    );
    return;
  }

  if (options.key.downArrow) {
    options.state.setInput(options.state.refs.history.current.readNextPrompt());
    return;
  }

  if (options.key.tab) completeTypingTab(options.state);
};

const completeTypingTab = (state: ComposerState): void => {
  if (state.inputSuggestions === null || state.inputSuggestions === undefined) return;

  const isSuggestionsSuggestionsEmpty = state.inputSuggestions.suggestions.length === 0;
  if (isSuggestionsSuggestionsEmpty) return;

  const nextInput = applyInputSuggestion(state.input, state.inputSuggestions);
  state.setInput(nextInput);
  const firstSuggestion = state.inputSuggestions.suggestions[0];

  const isFirstSuggestionMissing = firstSuggestion === undefined;
  if (isFirstSuggestionMissing) {
    state.setStatus("Completed ");
    return;
  }

  state.setStatus(`Completed ${firstSuggestion.label}`);
};
