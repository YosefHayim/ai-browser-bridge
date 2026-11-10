import { useApp, useInput } from "ink";
import { useCallback } from "react";
import type { ComposerKeyboardSettings } from "./composer-keyboard-types.ts";
import { consumeCommandListKey } from "./use-composer-keyboard-command.ts";
import { consumeGlobalShortcut, consumeTypingKey } from "./use-composer-keyboard-typing.ts";
import type { ComposerStatus } from "./use-composer-state.ts";

export const useComposerKeyboard = (settings: ComposerKeyboardSettings) => {
  const { exit } = useApp();
  useInput(
    (
      ...argumentList: [
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
      const char = argumentList[0];

      const key = argumentList[1];
      const isShortcutConsumed = consumeGlobalShortcut({ char, key, exit, state: settings.state });
      if (isShortcutConsumed) return;

      if (
        settings.state.mode === "command-list" &&
        consumeCommandListKey({ char, key, ...settings })
      )
        return;

      if (settings.state.mode === "typing") consumeTypingKey({ char, key, ...settings });
    },
  );
};

export const useComposerTabComplete = (status: ComposerStatus) => {
  return useCallback(() => {
    const isHitsEmpty = status.matches.length === 0;
    if (isHitsEmpty) return;

    let command = status.matches[status.selectedIndex];

    const isCommandMissing = command == null;
    if (isCommandMissing) command = status.matches[0];

    if (command == null) return;

    status.setInput(`/${command.name} `);
    status.setMode("typing");
  }, [status]);
};
