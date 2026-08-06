import type { ComposerState } from "./useComposerState.ts";

export type ComposerKeyboardOptions = {
  readonly state: ComposerState;
  readonly runCommand: (commandText: string) => Promise<void>;
  readonly tabComplete: () => void;
};
