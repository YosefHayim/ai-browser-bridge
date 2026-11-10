import type { ComposerStatus } from "./use-composer-state.ts";

export type ComposerKeyboardSettings = {
  readonly state: ComposerStatus;
  readonly runCommand: (commandString: string) => Promise<void>;
  readonly tabComplete: () => void;
};
