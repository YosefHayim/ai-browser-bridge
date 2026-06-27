import { useCallback } from "react";
import { useApp, useInput } from "ink";
import type { ComposerState } from "./use-composer-state.ts";
import type { ComposerKeyboardOptions } from "./composer-keyboard-types.ts";
import { handleCommandListKeys } from "./use-composer-keyboard-command.ts";
import { handleGlobalShortcuts, handleTypingKeys } from "./use-composer-keyboard-typing.ts";

export type { ComposerKeyboardOptions } from "./composer-keyboard-types.ts";

/** Registers Ink keyboard handlers for the composer. */
export function useComposerKeyboard(options: ComposerKeyboardOptions) {
  const { exit } = useApp();
  useInput((...args: [string, {
    ctrl?: boolean;
    upArrow?: boolean;
    downArrow?: boolean;
    tab?: boolean;
    return?: boolean;
  }]) => {
    const char = args[0];
    const key = args[1];
    if (handleGlobalShortcuts({ char, key, exit, state: options.state })) return;
    if (options.state.mode === "command-list" && handleCommandListKeys({ char, key, ...options })) return;
    if (options.state.mode === "typing") handleTypingKeys({ char, key, ...options });
  });
}

/** Creates the tab-complete handler for slash commands. */
export function useComposerTabComplete(state: ComposerState) {
  return useCallback(() => {
    if (state.matches.length === 0) return;
    const cmd = state.matches[state.selectedIdx] ?? state.matches[0];
    state.setInput(`/${cmd.name} `);
    state.setMode("typing");
  }, [state]);
}
