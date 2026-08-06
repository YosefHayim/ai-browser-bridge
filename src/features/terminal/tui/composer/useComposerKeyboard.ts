import { useApp, useInput } from "ink";
import { useCallback } from "react";
import type { ComposerKeyboardOptions } from "./composerKeyboardTypes.ts";
import { consumeCommandListKey } from "./useComposerKeyboardCommand.ts";
import { consumeGlobalShortcut, consumeTypingKey } from "./useComposerKeyboardTyping.ts";
import type { ComposerState } from "./useComposerState.ts";

/** Registers Ink keyboard handlers for the composer. */
export const useComposerKeyboard = (options: ComposerKeyboardOptions) => {
  const { exit } = useApp();
  useInput(
    (
      ...args: [
        string,
        {
          ctrl?: boolean;
          upArrow?: boolean;
          downArrow?: boolean;
          tab?: boolean;
          return?: boolean;
        },
      ]
    ) => {
      const char = args[0];
      const key = args[1];
      if (consumeGlobalShortcut({ char, key, exit, state: options.state })) return;
      if (options.state.mode === "command-list" && consumeCommandListKey({ char, key, ...options }))
        return;
      if (options.state.mode === "typing") consumeTypingKey({ char, key, ...options });
    },
  );
};

/** Tab-complete handler for slash commands. */
export const useComposerTabComplete = (state: ComposerState) => {
  return useCallback(() => {
    if (state.matches.length === 0) return;
    const cmd = state.matches[state.selectedIdx] ?? state.matches[0];
    if (cmd === undefined) return;
    state.setInput(`/${cmd.name} `);
    state.setMode("typing");
  }, [state]);
};
