import { withFilteredSuggestions } from "./filter-suggestions.ts";
import { type activeArgumentToken, hasTrailingWhitespace, splitArgs } from "./parse-slash-input.ts";
import { pathSuggestionGroup } from "./path-suggestions.ts";
import {
  checkpointSuggestions,
  rewindFlagSuggestions,
  sessionSuggestions,
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
  readonly token: ReturnType<typeof activeArgumentToken>;
};

export const exportArgumentSuggestions = async (
  input: CommandArgHandlerInput,
): Promise<InputSuggestionGroup> => {
  const tokens = splitArgs(input.slash.args);
  const isArgumentMissing =
    tokens.length === 0 || (tokens.length === 1 && !hasTrailingWhitespace(input.slash.args));
  if (isArgumentMissing) {
    return withFilteredSuggestions({
      group: input.base,
      suggestions: await sessionSuggestions(input.options),
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
    return withFilteredSuggestions({
      group: input.base,
      suggestions: await checkpointSuggestions(input.options),
      query: input.token.value,
      limit: input.options.limit,
    });
  }

  return pathSuggestionGroup({
    base: input.base,
    partial: input.token.value,
    options: input.options,
    kind: "all",
  });
};

export const rewindArgumentSuggestions = async (
  input: CommandArgHandlerInput,
): Promise<InputSuggestionGroup> => {
  const tokens = splitArgs(input.slash.args);

  const firstToken = tokens[0];
  if (shouldSuggestCheckpoints({ tokens, args: input.slash.args, firstToken })) {
    return checkpointFilteredSuggestions(input);
  }

  return rewindFallbackSuggestions({ input, tokens, firstToken });
};

const rewindFallbackSuggestions = async (parts: {
  readonly input: CommandArgHandlerInput;
  readonly tokens: string[];
  readonly firstToken: string | undefined;
}): Promise<InputSuggestionGroup> => {
  const isAtMostOneToken = parts.tokens.length <= 1;
  if (isAtMostOneToken) return rewindFlagSuggestionGroup(parts.input);

  const isFilesScopeFlag = parts.firstToken === "--files" || parts.firstToken === "--both";
  if (isFilesScopeFlag) {
    return checkpointFilteredSuggestions(parts.input);
  }

  return parts.input.base;
};

const rewindFlagSuggestionGroup = (input: CommandArgHandlerInput): InputSuggestionGroup => {
  return withFilteredSuggestions({
    group: input.base,
    suggestions: rewindFlagSuggestions(),
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

const checkpointFilteredSuggestions = async (
  input: CommandArgHandlerInput,
): Promise<InputSuggestionGroup> => {
  return withFilteredSuggestions({
    group: input.base,
    suggestions: await checkpointSuggestions(input.options),
    query: input.token.value,
    limit: input.options.limit,
  });
};
