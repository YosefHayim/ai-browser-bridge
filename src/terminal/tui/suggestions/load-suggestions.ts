import { completeFileMention } from "@/terminal/tui/composer/file-autocomplete-complete.ts";
import { readCommandArgumentSuggestions } from "./command-argument-suggestions.ts";
import { readCommandNameSuggestions } from "./command-name-suggestions.ts";
import { parseSlashLine } from "./parse-slash-input.ts";
import type { LoadPromptSuggestionsSettings, PromptSuggestionGroup } from "./types.ts";
import { readSuggestionLimit } from "./types.ts";

export const loadPromptSuggestions = async (
  details: string,
  settings: LoadPromptSuggestionsSettings,
): Promise<PromptSuggestionGroup | undefined> => {
  const limit = readSuggestionLimit(settings.limit);
  const fileMention = await completeFileMention(details, settings.repoRoot, { limit });

  const hasFileMention = fileMention != null;
  if (hasFileMention) return readFileMentionSuggestionGroup({ input: details, fileMention });

  return loadSlashSuggestions({ input: details, options: settings });
};

const loadSlashSuggestions = async (parts: {
  readonly input: string;
  readonly options: LoadPromptSuggestionsSettings;
}): Promise<PromptSuggestionGroup | null> => {
  const slash = parseSlashLine(parts.input);

  const isSlashMissing = slash == null;
  if (isSlashMissing) return null;

  const isTypingCommandName = !parts.input.includes(" ");
  if (isTypingCommandName) {
    return readCommandNameSuggestions({
      partial: slash.command,
      commands: parts.options.commands,
      options: parts.options,
    });
  }

  return readCommandArgumentSuggestions(slash, parts.options);
};

type FileMention = {
  readonly start: number;
  readonly end: number;
  readonly matches: Array<{ path: string; isDirectory: boolean }>;
};

const readFileMentionSuggestionGroup = (parts: {
  readonly input: string;
  readonly fileMention: FileMention;
}): PromptSuggestionGroup => {
  return {
    title: "Files and folders",
    hint: "Tab inserts the first match. Continue typing to narrow.",
    replacementStart: parts.fileMention.start,
    replacementEnd: parts.fileMention.end,
    suggestions: parts.fileMention.matches.map((hit) => ({
      value: `@${hit.path}`,
      label: `@${hit.path}`,
      kind: hit.isDirectory ? ("folder" as const) : ("file" as const),
    })),
  };
};
