import type { ComposerState } from "./useComposerState.ts";

/** Options for composer keyboard handling. */
export type ComposerKeyboardOptions = {
  /** Composer state container. */
  state: ComposerState;
  /** Slash command runner. */
  runCommand: (cmd: string) => Promise<void>;
  /** Tab completion handler. */
  tabComplete: () => void;
};
