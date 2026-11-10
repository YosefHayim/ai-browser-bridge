import { completeFileMention } from "@/terminal/tui/composer/file-autocomplete-complete.ts";
import { readCommandArgumentSuggestions } from "./command-argument-suggestions.ts";
import { readCommandNameSuggestions } from "./command-name-suggestions.ts";
import { parseSlashInput } from "./parse-slash-input.ts";
import type { InputSuggestionGroup, LoadInputSuggestionsOptions } from "./types.ts";
import { readSuggestionLimit } from "./types.ts";

export const loadInputSuggestions = async (
  input: string,
  options: LoadInputSuggestionsOptions,
): Promise<InputSuggestionGroup | undefined> => {
  const limit = readSuggestionLimit(options.limit);
  const fileMention = await completeFileMention(input, options.repoRoot, { limit });

  const hasFileMention = fileMention !== undefined;
  if (hasFileMention) return readFileMentionSuggestionGroup({ input, fileMention });

  return loadSlashSuggestions({ input, options });
};

const loadSlashSuggestions = async (parts: {
  readonly input: string;
  readonly options: LoadInputSuggestionsOptions;
}): Promise<InputSuggestionGroup | undefined> => {
  const slash = parseSlashInput(parts.input);

  const isSlashMissing = slash === undefined;
  if (isSlashMissing) return undefined;

  const isNotEmptyInParts = !parts.input.includes(" ");
  if (isNotEmptyInParts) {
    return readCommandNameSuggestions({
      partial: slash.command,
      commands: parts.options.commands,
      options: parts.options,
    });
  }

  return readCommandArgumentSuggestions(slash, parts.options);
};

type FileMentionMatch = {
  readonly start: number;
  readonly end: number;
  readonly matches: Array<{ path: string; isDirectory: boolean }>;
};

const readFileMentionSuggestionGroup = (parts: {
  readonly input: string;
  readonly fileMention: FileMentionMatch;
}): InputSuggestionGroup => {
  return {
    title: "Files and folders",
    hint: "Tab inserts the first match. Continue typing to narrow.",
    replacementStart: parts.fileMention.start,
    replacementEnd: parts.fileMention.end,
    suggestions: parts.fileMention.matches.map((match) => ({
      value: `@${match.path}`,
      label: `@${match.path}`,
      kind: match.isDirectory ? ("folder" as const) : ("file" as const),
    })),
  };
};
