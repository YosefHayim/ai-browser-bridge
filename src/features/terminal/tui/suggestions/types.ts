import type { CommandDef } from "@/features/domain";
import type { SessionStoreOptions } from "@/features/store";

export const DEFAULT_SUGGESTION_LIMIT = 8;

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

export type InputSuggestion = {
  readonly value: string;
  readonly label: string;
  readonly kind: SuggestionKind;
  readonly detail?: string;
};

export type InputSuggestionGroup = {
  readonly title: string;
  readonly hint?: string;
  readonly replacementStart?: number;
  readonly replacementEnd?: number;
  readonly suggestions: InputSuggestion[];
};

export type LoadInputSuggestionsOptions = {
  readonly repoRoot: string;
  readonly commands: readonly CommandDef[];
  readonly limit?: number;
  readonly sessionOptions?: SessionStoreOptions;
  readonly checkpointRoot?: string;
  readonly customCommandsHomeDir?: string;
};

export type ParsedSlashInput = {
  readonly command: string;
  readonly args: string;
  readonly argsStart: number;
};

export type CommandSuggestionRule = {
  readonly title: string;
  readonly hint: string;
  readonly values?: readonly InputSuggestion[];
};

export type ActiveArgumentToken = {
  readonly start: number;
  readonly end: number;
  readonly value: string;
};

export const suggestionLimit = (limit: number | undefined): number => {
  if (limit === undefined) return DEFAULT_SUGGESTION_LIMIT;
  return limit;
};
