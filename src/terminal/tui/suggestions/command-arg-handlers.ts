import { filterSuggestionGroup } from "./filter-suggestions.ts";
import {
  hasTrailingWhitespace,
  type readActiveArgumentToken,
  splitArgs,
} from "./parse-slash-input.ts";
import { readPathSuggestionGroup } from "./path-suggestions.ts";
import {
  listCheckpointSuggestions,
  listRewindFlagSuggestions,
  listSessionSuggestions,
} from "./session-checkpoint-suggestions.ts";
import type {
  InputSuggestionGroup,
  LoadInputSuggestionsOptions,
  ParsedSlashInput,
} from "./types.ts";

type CommandArgHandlerInput = {
  readonly slash: ParsedSlashInput;
  readonly options: LoadInputSuggestionsOptions;
  readonly base: InputSuggestionGroup;
  readonly token: ReturnType<typeof readActiveArgumentToken>;
};

export const exportArgumentSuggestions = async (
  input: CommandArgHandlerInput,
): Promise<InputSuggestionGroup> => {
  const tokens = splitArgs(input.slash.args);
  const isArgumentMissing =
    tokens.length === 0 || (tokens.length === 1 && !hasTrailingWhitespace(input.slash.args));
  if (isArgumentMissing) {
    return filterSuggestionGroup({
      group: input.base,
      suggestions: await listSessionSuggestions(input.options),
      query: input.token.value,
      limit: input.options.limit,
    });
  }

  return {
    ...input.base,
    hint: "Type the export output path. Supported extensions: .md, .json, .jsonl.",
  };
};

export const restoreArgumentSuggestions = async (
  input: CommandArgHandlerInput,
): Promise<InputSuggestionGroup> => {
  const tokens = splitArgs(input.slash.args);
  const isArgumentMissing =
    tokens.length === 0 || (tokens.length === 1 && !hasTrailingWhitespace(input.slash.args));
  if (isArgumentMissing) {
    return filterSuggestionGroup({
      group: input.base,
      suggestions: await listCheckpointSuggestions(input.options),
      query: input.token.value,
      limit: input.options.limit,
    });
  }

  return readPathSuggestionGroup({
    base: input.base,
    partial: input.token.value,
    options: input.options,
    kind: "all",
  });
};

export const readRewindArgumentSuggestions = async (
  input: CommandArgHandlerInput,
): Promise<InputSuggestionGroup> => {
  const tokens = splitArgs(input.slash.args);

  const firstToken = tokens[0];
  if (shouldSuggestCheckpoints({ tokens, args: input.slash.args, firstToken })) {
    return readCheckpointFilteredSuggestions(input);
  }

  return readRewindFallbackSuggestions({ input, tokens, firstToken });
};

const readRewindFallbackSuggestions = async (parts: {
  readonly input: CommandArgHandlerInput;
  readonly tokens: string[];
  readonly firstToken: string | undefined;
}): Promise<InputSuggestionGroup> => {
  const isAtMostOneToken = parts.tokens.length <= 1;
  if (isAtMostOneToken) return readRewindFlagSuggestionGroup(parts.input);

  const isFilesScopeFlag = parts.firstToken === "--files" || parts.firstToken === "--both";
  if (isFilesScopeFlag) {
    return readCheckpointFilteredSuggestions(parts.input);
  }

  return parts.input.base;
};

const readRewindFlagSuggestionGroup = (input: CommandArgHandlerInput): InputSuggestionGroup => {
  return filterSuggestionGroup({
    group: input.base,
    suggestions: listRewindFlagSuggestions(),
    query: input.token.value,
    limit: input.options.limit,
  });
};

const shouldSuggestCheckpoints = (parts: {
  readonly tokens: string[];
  readonly args: string;
  readonly firstToken: string | undefined;
}): boolean => {
  const isNotFilesScopeFlag = parts.firstToken !== "--files" && parts.firstToken !== "--both";
  if (isNotFilesScopeFlag) return false;

  return parts.tokens.length > 1 || hasTrailingWhitespace(parts.args);
};

const readCheckpointFilteredSuggestions = async (
  input: CommandArgHandlerInput,
): Promise<InputSuggestionGroup> => {
  return filterSuggestionGroup({
    group: input.base,
    suggestions: await listCheckpointSuggestions(input.options),
    query: input.token.value,
    limit: input.options.limit,
  });
};
