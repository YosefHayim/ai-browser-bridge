import { applyPromptSuggestion } from "@/terminal/tui/suggestions/filter-suggestions.ts";
import { reverseHistorySearch } from "./composer-history.ts";
import type { ComposerKeyboardSettings } from "./composer-keyboard-types.ts";
import type { ComposerStatus } from "./use-composer-state.ts";

export const consumeGlobalShortcut = (settings: {
  char: string;
  key: { ctrl?: boolean };
  exit: () => void;
  state: ComposerStatus;
}): boolean => {
  if (settings.key.ctrl && settings.char === "c") {
    settings.exit();
    return true;
  }

  if (settings.key.ctrl && (settings.char === "r" || settings.char === "\u0012")) {
    applyFoundHistoryPrompt(settings.state);
    return true;
  }

  return false;
};

const applyFoundHistoryPrompt = (status: ComposerStatus): void => {
  const historyPrompt = reverseHistorySearch(
    status.refs.history.current.listPrompts(),
    status.input,
  );
  const isHitMissing = historyPrompt == null;
  if (isHitMissing) {
    status.setStatus(`No history match for "${status.input}"`);
    return;
  }

  status.setInput(historyPrompt);
  status.setStatus(`History match: ${historyPrompt}`);
};

export const consumeTypingKey = (
  settings: ComposerKeyboardSettings & {
    char: string;
    key: { upArrow?: boolean; downArrow?: boolean; tab?: boolean };
  },
): void => {
  if (settings.key.upArrow) {
    settings.state.setInput(
      settings.state.refs.history.current.readPreviousPrompt(settings.state.input),
    );
    return;
  }

  if (settings.key.downArrow) {
    settings.state.setInput(settings.state.refs.history.current.readNextPrompt());
    return;
  }

  if (settings.key.tab) completeTypingTab(settings.state);
};

const completeTypingTab = (status: ComposerStatus): void => {
  if (status.inputSuggestions == null) return;

  const isSuggestionsEmpty = status.inputSuggestions.suggestions.length === 0;
  if (isSuggestionsEmpty) return;

  const nextPrompt = applyPromptSuggestion(status.input, status.inputSuggestions);
  status.setInput(nextPrompt);
  const firstSuggestion = status.inputSuggestions.suggestions[0];

  const isFirstSuggestionMissing = firstSuggestion == null;
  if (isFirstSuggestionMissing) {
    status.setStatus("Completed ");
    return;
  }

  status.setStatus(`Completed ${firstSuggestion.label}`);
};
