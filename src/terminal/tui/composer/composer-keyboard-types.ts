import type { ComposerStatus } from "@/terminal/tui/composer/use-composer-state.ts";

export type ComposerKeyboardSettings = {
  readonly state: ComposerStatus;
  readonly runCommand: (commandString: string) => Promise<void>;
  readonly tabComplete: () => void;
};
