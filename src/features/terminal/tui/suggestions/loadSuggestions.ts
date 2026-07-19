import { completeFileMention } from "../composer/fileAutocomplete.ts";
import { commandArgumentSuggestions } from "./commandArgumentSuggestions.ts";
import { commandNameSuggestions } from "./commandNameSuggestions.ts";
import { parseSlashInput } from "./parseSlashInput.ts";
import type { InputSuggestionGroup, LoadInputSuggestionsOptions } from "./types.ts";
import { DEFAULT_SUGGESTION_LIMIT } from "./types.ts";

/**
 * Load autocomplete suggestions for the current composer input.
 *
 * @param input - Input values for the operation.
 * @param options - Options that configure the operation.
 * @returns The `loadInputSuggestions` result.
 * @example
 * ```ts
 * const result = await loadInputSuggestions(input, options);
 * ```
 */
export const loadInputSuggestions = async (
  input: string,
  options: LoadInputSuggestionsOptions,
): Promise<InputSuggestionGroup | null> => {
  const limit = options.limit ?? DEFAULT_SUGGESTION_LIMIT;
  const fileMention = await completeFileMention(input, options.repoRoot, { limit });
  if (fileMention) return fileMentionSuggestionGroup({ input, fileMention });
  return loadSlashSuggestions({ input, options });
};

/** Load slash command name or argument suggestions. */
const loadSlashSuggestions = async (input: {
  input: string;
  options: LoadInputSuggestionsOptions;
}): Promise<InputSuggestionGroup | null> => {
  const slash = parseSlashInput(input.input);
  if (!slash) return null;
  if (!input.input.includes(" ")) {
    return commandNameSuggestions({
      partial: slash.command,
      commands: input.options.commands,
      options: input.options,
    });
  }
  return commandArgumentSuggestions(slash, input.options);
};

/** Inputs for mapping file mention matches to a suggestion group. */
interface FileMentionMatch {
  start: number;
  end: number;
  matches: Array<{ path: string; isDirectory: boolean }>;
}

/** Build a suggestion group from active @ file mention matches. */
const fileMentionSuggestionGroup = (input: {
  input: string;
  fileMention: FileMentionMatch;
}): InputSuggestionGroup => {
  return {
    title: "Files and folders",
    hint: "Tab inserts the first match. Continue typing to narrow.",
    replacementStart: input.fileMention.start,
    replacementEnd: input.fileMention.end,
    suggestions: input.fileMention.matches.map((match) => ({
      value: `@${match.path}`,
      label: `@${match.path}`,
      kind: match.isDirectory ? ("folder" as const) : ("file" as const),
    })),
  };
};
