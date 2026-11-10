import { useApp, useInput } from "ink";
import { useCallback } from "react";
import type { ComposerKeyboardSettings } from "./composer-keyboard-types.ts";
import { consumeCommandListKey } from "./use-composer-keyboard-command.ts";
import { consumeGlobalShortcut, consumeTypingKey } from "./use-composer-keyboard-typing.ts";
import type { ComposerStatus } from "./use-composer-state.ts";

const COMMAND_LIST_MODE = "command-list";
const TYPING_MODE = "typing";

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

      const isCommandListMode = settings.state.mode === COMMAND_LIST_MODE;
      const isCommandKeyConsumed =
        isCommandListMode && consumeCommandListKey({ char, key, ...settings });
      if (isCommandKeyConsumed) return;

      const isTypingMode = settings.state.mode === TYPING_MODE;
      if (isTypingMode) consumeTypingKey({ char, key, ...settings });
    },
  );
};

export const useComposerTabComplete = (status: ComposerStatus) => {
  return useCallback(() => {
    const isHitsEmpty = status.matches.length === 0;
    if (isHitsEmpty) return;

    const selectedCommand = status.matches[status.selectedIndex];

    const isSelectedCommandMissing = selectedCommand == null;
    const command = isSelectedCommandMissing ? status.matches[0] : selectedCommand;

    const isCommandMissing = command == null;
    if (isCommandMissing) return;

    status.setInput(`/${command.name} `);
    status.setMode(TYPING_MODE);
  }, [status]);
};
