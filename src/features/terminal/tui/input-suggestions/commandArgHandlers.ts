import { withFilteredSuggestions } from "./filterSuggestions.ts";
import { type activeArgumentToken, hasTrailingWhitespace, splitArgs } from "./parseSlashInput.ts";
import { pathSuggestionGroup } from "./pathSuggestions.ts";
import {
  checkpointSuggestions,
  rewindFlagSuggestions,
  sessionSuggestions,
} from "./sessionCheckpointSuggestions.ts";
import type {
  InputSuggestionGroup,
  LoadInputSuggestionsOptions,
  ParsedSlashInput,
} from "./types.ts";

/** Inputs for export/restore/rewind argument suggestion handlers. */
interface CommandArgHandlerParams {
  slash: ParsedSlashInput;
  options: LoadInputSuggestionsOptions;
  base: InputSuggestionGroup;
  token: ReturnType<typeof activeArgumentToken>;
}

/** Suggest session ids or output path hint for /export. */
export async function exportArgumentSuggestions(
  params: CommandArgHandlerParams,
): Promise<InputSuggestionGroup> {
  const tokens = splitArgs(params.slash.args);
  if (tokens.length === 0 || (tokens.length === 1 && !hasTrailingWhitespace(params.slash.args))) {
    return withFilteredSuggestions({
      group: params.base,
      suggestions: await sessionSuggestions(params.options),
      query: params.token.value,
      limit: params.options.limit,
    });
  }
  return {
    ...params.base,
    hint: "Type the export output path. Supported extensions: .md, .json, .jsonl.",
  };
}

/** Suggest checkpoint ids or repo paths for /restore. */
export async function restoreArgumentSuggestions(
  params: CommandArgHandlerParams,
): Promise<InputSuggestionGroup> {
  const tokens = splitArgs(params.slash.args);
  if (tokens.length === 0 || (tokens.length === 1 && !hasTrailingWhitespace(params.slash.args))) {
    return withFilteredSuggestions({
      group: params.base,
      suggestions: await checkpointSuggestions(params.options),
      query: params.token.value,
      limit: params.options.limit,
    });
  }
  return pathSuggestionGroup({
    base: params.base,
    partial: params.token.value,
    options: params.options,
    kind: "all",
  });
}

/** Suggest rewind flags or checkpoint ids for /rewind and /retry. */
export async function rewindArgumentSuggestions(
  params: CommandArgHandlerParams,
): Promise<InputSuggestionGroup> {
  const tokens = splitArgs(params.slash.args);
  const firstToken = tokens[0];
  if (shouldSuggestCheckpoints({ tokens, args: params.slash.args, firstToken })) {
    return checkpointFilteredSuggestions(params);
  }
  return resolveRewindArgumentSuggestions({ params, tokens, firstToken });
}

/** Resolve rewind suggestions after checkpoint filtering is ruled out. */
async function resolveRewindArgumentSuggestions(input: {
  params: CommandArgHandlerParams;
  tokens: string[];
  firstToken: string | undefined;
}): Promise<InputSuggestionGroup> {
  if (input.tokens.length <= 1) return rewindFlagSuggestionGroup(input.params);
  if (input.firstToken === "--files" || input.firstToken === "--both")
    return checkpointFilteredSuggestions(input.params);
  return input.params.base;
}

/** Suggest rewind mode flags for the first argument token. */
function rewindFlagSuggestionGroup(params: CommandArgHandlerParams): InputSuggestionGroup {
  return withFilteredSuggestions({
    group: params.base,
    suggestions: rewindFlagSuggestions(),
    query: params.token.value,
    limit: params.options.limit,
  });
}

/** Whether rewind args should show checkpoint suggestions. */
function shouldSuggestCheckpoints(input: {
  tokens: string[];
  args: string;
  firstToken: string | undefined;
}): boolean {
  return (
    (input.firstToken === "--files" || input.firstToken === "--both") &&
    (input.tokens.length > 1 || hasTrailingWhitespace(input.args))
  );
}

/** Filter checkpoint suggestions for rewind restore steps. */
async function checkpointFilteredSuggestions(
  params: CommandArgHandlerParams,
): Promise<InputSuggestionGroup> {
  return withFilteredSuggestions({
    group: params.base,
    suggestions: await checkpointSuggestions(params.options),
    query: params.token.value,
    limit: params.options.limit,
  });
}
