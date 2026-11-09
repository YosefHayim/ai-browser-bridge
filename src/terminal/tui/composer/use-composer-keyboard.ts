import { useApp, useInput } from "ink";
import { useCallback } from "react";
import type { ComposerKeyboardOptions } from "./composer-keyboard-types.ts";
import { consumeCommandListKey } from "./use-composer-keyboard-command.ts";
import { consumeGlobalShortcut, consumeTypingKey } from "./use-composer-keyboard-typing.ts";
import type { ComposerState } from "./use-composer-state.ts";

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
      const isShortcutConsumed = consumeGlobalShortcut({ char, key, exit, state: options.state });
      if (isShortcutConsumed) return;

      if (options.state.mode === "command-list" && consumeCommandListKey({ char, key, ...options }))
        return;

      if (options.state.mode === "typing") consumeTypingKey({ char, key, ...options });
    },
  );
};

export const useComposerTabComplete = (state: ComposerState) => {
  return useCallback(() => {
    const isMatchesEmpty = state.matches.length === 0;
    if (isMatchesEmpty) return;

    let command = state.matches[state.selectedIdx];

    const isCommandMissing = command === undefined;
    if (isCommandMissing) command = state.matches[0];

    if (command === undefined) return;

    state.setInput(`/${command.name} `);
    state.setMode("typing");
  }, [state]);
};
