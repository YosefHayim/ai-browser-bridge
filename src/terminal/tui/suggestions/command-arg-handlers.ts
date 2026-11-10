import { filterSuggestionGroup } from "./filter-suggestions.ts";
import {
  hasTrailingWhitespace,
  type readActiveArgumentToken,
  splitArgumentList,
} from "./parse-slash-input.ts";
import { readPathSuggestionGroup } from "./path-suggestions.ts";
import {
  listCheckpointSuggestions,
  listRewindFlagSuggestions,
  listSessionSuggestions,
} from "./session-checkpoint-suggestions.ts";
import type {
  LoadPromptSuggestionsSettings,
  ParsedSlashLine,
  PromptSuggestionGroup,
} from "./types.ts";

type CommandArgHandlerDetails = {
  readonly slash: ParsedSlashLine;
  readonly options: LoadPromptSuggestionsSettings;
  readonly base: PromptSuggestionGroup;
  readonly token: ReturnType<typeof readActiveArgumentToken>;
};

export const exportArgumentSuggestions = async (
  details: CommandArgHandlerDetails,
): Promise<PromptSuggestionGroup> => {
  const tokens = splitArgumentList(details.slash.args);

  const isArgumentMissing =
    tokens.length === 0 || (tokens.length === 1 && !hasTrailingWhitespace(details.slash.args));
  if (isArgumentMissing) {
    return filterSuggestionGroup({
      group: details.base,
      suggestions: await listSessionSuggestions(details.options),
      query: details.token.value,
      limit: details.options.limit,
    });
  }

  return {
    ...details.base,
    hint: "Type the export output path. Supported extensions: .md, .json, .jsonl.",
  };
};

export const restoreArgumentSuggestions = async (
  details: CommandArgHandlerDetails,
): Promise<PromptSuggestionGroup> => {
  const tokens = splitArgumentList(details.slash.args);

  const isArgumentMissing =
    tokens.length === 0 || (tokens.length === 1 && !hasTrailingWhitespace(details.slash.args));
  if (isArgumentMissing) {
    return filterSuggestionGroup({
      group: details.base,
      suggestions: await listCheckpointSuggestions(details.options),
      query: details.token.value,
      limit: details.options.limit,
    });
  }

  return readPathSuggestionGroup({
    base: details.base,
    partial: details.token.value,
    options: details.options,
    kind: "all",
  });
};

export const readRewindArgumentSuggestions = async (
  details: CommandArgHandlerDetails,
): Promise<PromptSuggestionGroup> => {
  const tokens = splitArgumentList(details.slash.args);

  const firstToken = tokens[0];
  if (canSuggestCheckpoints({ tokens, args: details.slash.args, firstToken })) {
    return readCheckpointFilteredSuggestions(details);
  }

  return readRewindFallbackSuggestions({ input: details, tokens, firstToken });
};

const readRewindFallbackSuggestions = async (parts: {
  readonly input: CommandArgHandlerDetails;
  readonly tokens: string[];
  readonly firstToken: string | undefined;
}): Promise<PromptSuggestionGroup> => {
  const isAtMostOneToken = parts.tokens.length <= 1;
  if (isAtMostOneToken) return readRewindFlagSuggestionGroup(parts.input);

  const isFilesScopeFlag = parts.firstToken === "--files" || parts.firstToken === "--both";
  if (isFilesScopeFlag) {
    return readCheckpointFilteredSuggestions(parts.input);
  }

  return parts.input.base;
};

const readRewindFlagSuggestionGroup = (
  details: CommandArgHandlerDetails,
): PromptSuggestionGroup => {
  return filterSuggestionGroup({
    group: details.base,
    suggestions: listRewindFlagSuggestions(),
    query: details.token.value,
    limit: details.options.limit,
  });
};

const canSuggestCheckpoints = (parts: {
  readonly tokens: string[];
  readonly args: string;
  readonly firstToken: string | undefined;
}): boolean => {
  const isNotFilesScopeFlag = parts.firstToken !== "--files" && parts.firstToken !== "--both";
  if (isNotFilesScopeFlag) return false;

  return parts.tokens.length > 1 || hasTrailingWhitespace(parts.args);
};

const readCheckpointFilteredSuggestions = async (
  details: CommandArgHandlerDetails,
): Promise<PromptSuggestionGroup> => {
  return filterSuggestionGroup({
    group: details.base,
    suggestions: await listCheckpointSuggestions(details.options),
    query: details.token.value,
    limit: details.options.limit,
  });
};
