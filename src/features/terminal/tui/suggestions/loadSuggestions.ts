import { completeFileMention } from "../composer/fileAutocomplete.ts";
import { commandArgumentSuggestions } from "./commandArgumentSuggestions.ts";
import { commandNameSuggestions } from "./commandNameSuggestions.ts";
import { parseSlashInput } from "./parseSlashInput.ts";
import type { InputSuggestionGroup, LoadInputSuggestionsOptions } from "./types.ts";
import { DEFAULT_SUGGESTION_LIMIT } from "./types.ts";

/** Load autocomplete suggestions for the current composer input. */
export const loadInputSuggestions = async (
  input: string,
  options: LoadInputSuggestionsOptions,
): Promise<InputSuggestionGroup | undefined> => {
  const limit = options.limit === undefined ? DEFAULT_SUGGESTION_LIMIT : options.limit;
  const fileMention = await completeFileMention(input, options.repoRoot, { limit });
  if (fileMention !== undefined) return fileMentionSuggestionGroup({ input, fileMention });
  return loadSlashSuggestions({ input, options });
};

/** Load slash command name or argument suggestions. */
const loadSlashSuggestions = async (input: {
  input: string;
  options: LoadInputSuggestionsOptions;
}): Promise<InputSuggestionGroup | undefined> => {
  const slash = parseSlashInput(input.input);
  if (slash === undefined) return undefined;
  if (!input.input.includes(" ")) {
    const names = await commandNameSuggestions({
      partial: slash.command,
      commands: input.options.commands,
      options: input.options,
    });
    if (names === null) return undefined;
    return names;
  }
  const args = await commandArgumentSuggestions(slash, input.options);
  if (args === null) return undefined;
  return args;
};

type FileMentionMatch = {
  start: number;
  end: number;
  matches: Array<{ path: string; isDirectory: boolean }>;
};

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
