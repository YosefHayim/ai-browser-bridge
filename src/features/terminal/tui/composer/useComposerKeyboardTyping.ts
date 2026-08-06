import { applyInputSuggestion } from "../suggestions/inputSuggestions.ts";
import { reverseHistoryMatch } from "./composerHistory.ts";
import type { ComposerKeyboardOptions } from "./composerKeyboardTypes.ts";
import type { ComposerState } from "./useComposerState.ts";

/** Ctrl shortcuts that leave typing mode (exit, reverse history search). */
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
  const match = reverseHistoryMatch(state.refs.history.current.entries(), state.input);
  if (match === undefined) {
    state.setStatus(`No history match for "${state.input}"`);
    return;
  }
  state.setInput(match);
  state.setStatus(`History match: ${match}`);
};

/** Arrow and tab keys while the composer is in free typing mode. */
export const consumeTypingKey = (
  options: ComposerKeyboardOptions & {
    char: string;
    key: { upArrow?: boolean; downArrow?: boolean; tab?: boolean };
  },
): void => {
  if (options.key.upArrow) {
    options.state.setInput(options.state.refs.history.current.previous(options.state.input));
    return;
  }
  if (options.key.downArrow) {
    options.state.setInput(options.state.refs.history.current.next());
    return;
  }
  if (options.key.tab) completeTypingTab(options.state);
};

const completeTypingTab = (state: ComposerState): void => {
  if (!state.inputSuggestions?.suggestions.length) return;
  const nextInput = applyInputSuggestion(state.input, state.inputSuggestions);
  state.setInput(nextInput);
  const firstLabel = state.inputSuggestions.suggestions[0]?.label;
  if (firstLabel === undefined) {
    state.setStatus("Completed ");
    return;
  }
  state.setStatus(`Completed ${firstLabel}`);
};
