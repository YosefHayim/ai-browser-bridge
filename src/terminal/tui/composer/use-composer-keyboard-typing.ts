import { applyPromptSuggestion } from "@/terminal/tui/suggestions/filter-suggestions.ts";
import {
  listPrompts,
  pickNextPromptStep,
  pickPreviousPromptStep,
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
  const isCtrlHeld = settings.key.ctrl === true;

  const isCtrlC = isCtrlHeld && settings.char === "c";
  if (isCtrlC) {
    settings.exit();
    return true;
  }

  const isCtrlR = isCtrlHeld && (settings.char === "r" || settings.char === "\u0012");
  if (isCtrlR) {
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
    const previousPromptStep = pickPreviousPromptStep(
      settings.state.refs.history.current,
      settings.state.input,
    );
    settings.state.refs.history.current = previousPromptStep.history;
    settings.state.setInput(previousPromptStep.prompt);
    return;
  }

  if (settings.key.downArrow) {
    const nextPromptStep = pickNextPromptStep(settings.state.refs.history.current);
    settings.state.refs.history.current = nextPromptStep.history;
    settings.state.setInput(nextPromptStep.prompt);
    return;
  }

  if (settings.key.tab) completeTypingTab(settings.state);
};

const completeTypingTab = (status: ComposerStatus): void => {
  const { promptSuggestions } = status;

  const isPromptSuggestionsMissing = promptSuggestions == null;
  if (isPromptSuggestionsMissing) return;

  const isSuggestionsEmpty = promptSuggestions.suggestions.length === 0;
  if (isSuggestionsEmpty) return;

  const nextPrompt = applyPromptSuggestion(status.input, promptSuggestions);
  status.setInput(nextPrompt);
  const firstSuggestion = promptSuggestions.suggestions[0];

  const isFirstSuggestionMissing = firstSuggestion == null;
  if (isFirstSuggestionMissing) {
    status.setStatus("Completed ");
    return;
  }

  status.setStatus(`Completed ${firstSuggestion.label}`);
};
