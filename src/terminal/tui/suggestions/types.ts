import type { CommandDef } from "@/domain/command-types.ts";
import type { SessionStoreSettings } from "@/store/session-store.ts";

const DEFAULT_SUGGESTION_LIMIT = 8;

type SuggestionKind =
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

export type PromptSuggestion = {
  readonly value: string;
  readonly label: string;
  readonly kind: SuggestionKind;
  readonly detail?: string;
};

export type PromptSuggestionGroup = {
  readonly title: string;
  readonly hint?: string;
  readonly replacementStart?: number | null;
  readonly replacementEnd?: number | null;
  readonly suggestions: PromptSuggestion[];
};

export type LoadPromptSuggestionsSettings = {
  readonly repoRoot: string;
  readonly commands: readonly CommandDef[];
  readonly limit?: number;
  readonly sessionOptions?: SessionStoreSettings;
  readonly checkpointRoot?: string;
  readonly customCommandsHomeDir?: string;
};

export type ParsedSlashLine = {
  readonly command: string;
  readonly args: string;
  readonly argsStart: number;
};

export type CommandSuggestionRule = {
  readonly title: string;
  readonly hint: string;
  readonly values?: readonly PromptSuggestion[];
};

export type ActiveArgumentToken = {
  readonly start: number;
  readonly end: number;
  readonly value: string;
};

export const readSuggestionLimit = (limit: number | undefined): number => {
  const isLimitMissing = limit == null;
  if (isLimitMissing) return DEFAULT_SUGGESTION_LIMIT;

  return limit;
};
