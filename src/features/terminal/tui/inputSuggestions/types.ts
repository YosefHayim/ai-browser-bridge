/** Kind of autocomplete item shown in the composer assist panel. */
export type SuggestionKind =
  | "command"
  | "file"
  | "folder"
  | "mode"
  | "session"
  | "checkpoint"
  | "model"
  | "scope"
  | "flag"
  | "url"
  | "text";

/** One autocomplete candidate for the composer input. */
export interface InputSuggestion {
  value: string;
  label: string;
  kind: SuggestionKind;
  detail?: string;
}

/** Group of related autocomplete candidates with replacement range metadata. */
export interface InputSuggestionGroup {
  title: string;
  hint?: string;
  replacementStart?: number;
  replacementEnd?: number;
  suggestions: InputSuggestion[];
}

/** Inputs for loading autocomplete suggestions for the current input. */
export interface LoadInputSuggestionsOptions {
  repoRoot: string;
  commands: readonly import("../../../domain/types.ts").CommandDef[];
  limit?: number;
  sessionOptions?: import("../../../store/sessionStore.ts").SessionStoreOptions;
  checkpointRoot?: string;
  customCommandsHomeDir?: string;
}

/** Parsed slash-command input with command name and trailing args. */
export interface ParsedSlashInput {
  command: string;
  args: string;
  argsStart: number;
}

/** Rule metadata for slash-command argument suggestions. */
export interface CommandSuggestionRule {
  title: string;
  hint: string;
  values?: readonly InputSuggestion[];
}

/** Active argument token within a slash command's args string. */
export interface ActiveArgumentToken {
  start: number;
  end: number;
  value: string;
}

export const DEFAULT_SUGGESTION_LIMIT = 8;
