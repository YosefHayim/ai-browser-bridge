import type { CommandDef } from "@/domain/command-types.ts";
import { loadCustomCommands } from "@/user-config/custom-commands.ts";
import type {
  LoadPromptSuggestionsSettings,
  PromptSuggestion,
  PromptSuggestionGroup,
} from "./types.ts";
import { readSuggestionLimit } from "./types.ts";

const COMMAND_SUGGESTION_KIND = "command" as const;

type CommandNameSuggestionsDetails = {
  readonly partial: string;
  readonly commands: readonly CommandDef[];
  readonly options: LoadPromptSuggestionsSettings;
};

export const readCommandNameSuggestions = async (
  details: CommandNameSuggestionsDetails,
): Promise<PromptSuggestionGroup> => {
  const custom = await loadCustomCommands({
    repoRoot: details.options.repoRoot,
    homeDir: details.options.customCommandsHomeDir,
  });

  return {
    title: "Commands",
    hint: "Tab inserts the first command. Enter runs the selected command.",
    replacementStart: 0,
    replacementEnd: details.partial.length + 1,
    suggestions: listMatchingCommandNames({ input: details, custom }),
  };
};

const listMatchingCommandNames = (parts: {
  readonly input: CommandNameSuggestionsDetails;
  readonly custom: Awaited<ReturnType<typeof loadCustomCommands>>;
}): PromptSuggestion[] => {
  const builtIns = parts.input.commands.map((command) => ({
    value: `/${command.name} `,
    label: `/${command.name}`,
    kind: COMMAND_SUGGESTION_KIND,
    detail: command.description,
  }));
  const customSuggestions = parts.custom.map((command) => {
    const isCommandDescriptionMissing = command.description == null;
    const detail = isCommandDescriptionMissing
      ? `${command.source} custom command`
      : command.description;

    return {
      value: `/${command.name} `,
      label: `/${command.name}`,
      kind: COMMAND_SUGGESTION_KIND,
      detail,
    };
  });
  const query = parts.input.partial.toLowerCase();
  const limit = readSuggestionLimit(parts.input.options.limit);

  return [...builtIns, ...customSuggestions]
    .filter((suggestion) => suggestion.label.slice(1).toLowerCase().startsWith(query))
    .slice(0, limit);
};
