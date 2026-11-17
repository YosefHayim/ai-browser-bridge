import { type Key, useApp, useInput } from "ink";
import { useCallback } from "react";
import { consumeCommandListKey } from "@/terminal/tui/composer/use-composer-keyboard-command.ts";
import {
  consumeGlobalShortcut,
  consumeTypingKey,
} from "@/terminal/tui/composer/use-composer-keyboard-typing.ts";
import type { ComposerStatus } from "@/terminal/tui/composer/use-composer-state.ts";

export interface ComposerKeyboardSettings {
  readonly state: ComposerStatus;
  readonly runCommand: (commandString: string) => Promise<void>;
  readonly tabComplete: () => void;
}

interface ComposerKeyboardHookSettings extends ComposerKeyboardSettings {
  readonly handleEscapePress: () => void;
}

export function useComposerKeyboard(settings: ComposerKeyboardHookSettings) {
  const { exit } = useApp();

  function handleComposerKeyPress(typedCharacters: string, key: Key) {
    const isEscape = key.escape;
    if (isEscape) {
      settings.handleEscapePress();
      return;
    }

    const isShortcutConsumed = consumeGlobalShortcut({
      char: typedCharacters,
      key,
      exit,
      state: settings.state,
    });
    if (isShortcutConsumed) return;

    const isCommandListMode = settings.state.mode === "command-list";
    if (isCommandListMode) {
      const isCommandKeyConsumed = consumeCommandListKey({
        char: typedCharacters,
        key,
        ...settings,
      });
      if (isCommandKeyConsumed) return;
    }

    const isTypingMode = settings.state.mode === "typing";
    if (isTypingMode) consumeTypingKey({ char: typedCharacters, key, ...settings });
  }

  useInput(handleComposerKeyPress);
}

export function useComposerTabComplete(status: ComposerStatus) {
  return useCallback(() => {
    const isHitsEmpty = status.matches.length === 0;
    if (isHitsEmpty) return;

    const selectedCommand = status.matches[status.selectedIndex];

    const isSelectedCommandMissing = selectedCommand == null;
    const command = isSelectedCommandMissing ? status.matches[0] : selectedCommand;

    const isCommandMissing = command == null;
    if (isCommandMissing) return;

    status.setInput(`/${command.name} `);
    status.setMode("typing");
  }, [status]);
}
