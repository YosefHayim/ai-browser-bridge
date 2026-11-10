import { applyPromptSuggestion } from "@/terminal/tui/suggestions/filter-suggestions.ts";
import {
  listPrompts,
  readNextPrompt,
  readPreviousPrompt,
  reverseHistorySearch,
} from "./composer-history.ts";
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
  const historyPrompts = listPrompts(status.refs.history.current);
  const historyPrompt = reverseHistorySearch(historyPrompts, status.input);

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
    const previousPrompt = readPreviousPrompt(
      settings.state.refs.history.current,
      settings.state.input,
    );
    settings.state.setInput(previousPrompt);
    return;
  }

  if (settings.key.downArrow) {
    const nextPrompt = readNextPrompt(settings.state.refs.history.current);
    settings.state.setInput(nextPrompt);
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
