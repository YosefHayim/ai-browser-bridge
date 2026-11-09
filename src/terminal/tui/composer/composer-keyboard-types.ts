import type { ComposerState } from "./use-composer-state.ts";

export type ComposerKeyboardOptions = {
  readonly state: ComposerState;
  readonly runCommand: (commandText: string) => Promise<void>;
  readonly tabComplete: () => void;
};
