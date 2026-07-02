import { findReverseHistoryMatch } from "./composerHistory.ts";
import type { ComposerKeyboardOptions } from "./composerKeyboardTypes.ts";
import { applyInputSuggestion } from "./inputSuggestions.ts";
import type { ComposerState } from "./useComposerState.ts";

export function handleGlobalShortcuts(options: {
  char: string;
  key: { ctrl?: boolean };
  exit: () => void;
  state: ComposerState;
}) {
  if (options.key.ctrl && options.char === "c") {
    options.exit();
    return true;
  }
  if (options.key.ctrl && (options.char === "r" || options.char === "\u0012")) {
    applyHistoryMatch(options.state);
    return true;
  }
  return false;
}

function applyHistoryMatch(state: ComposerState) {
  const match = findReverseHistoryMatch(state.refs.history.current.entries(), state.input);
  if (!match) {
    state.setStatus(`No history match for "${state.input}"`);
    return;
  }
  state.setInput(match);
  state.setStatus(`History match: ${match}`);
}

export function handleTypingKeys(
  options: ComposerKeyboardOptions & {
    char: string;
    key: { upArrow?: boolean; downArrow?: boolean; tab?: boolean };
  },
) {
  if (options.key.upArrow) {
    options.state.setInput(options.state.refs.history.current.previous(options.state.input));
    return;
  }
  if (options.key.downArrow) {
    options.state.setInput(options.state.refs.history.current.next());
    return;
  }
  if (options.key.tab) completeTypingTab(options.state);
}

function completeTypingTab(state: ComposerState) {
  if (!state.inputSuggestions?.suggestions.length) return;
  const nextInput = applyInputSuggestion(state.input, state.inputSuggestions);
  state.setInput(nextInput);
  state.setStatus(`Completed ${state.inputSuggestions.suggestions[0]?.label ?? ""}`);
}
