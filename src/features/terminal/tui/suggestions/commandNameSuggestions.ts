import type { CommandDef } from "@/features/domain";
import { loadCustomCommands } from "@/features/userConfig";
import type {
  InputSuggestion,
  InputSuggestionGroup,
  LoadInputSuggestionsOptions,
} from "./types.ts";
import { suggestionLimit } from "./types.ts";

type CommandNameSuggestionsInput = {
  readonly partial: string;
  readonly commands: readonly CommandDef[];
  readonly options: LoadInputSuggestionsOptions;
};

export const commandNameSuggestions = async (
  input: CommandNameSuggestionsInput,
): Promise<InputSuggestionGroup> => {
  const custom = await loadCustomCommands({
    repoRoot: input.options.repoRoot,
    homeDir: input.options.customCommandsHomeDir,
  });
  return {
    title: "Commands",
    hint: "Tab inserts the first command. Enter runs the selected command.",
    replacementStart: 0,
    replacementEnd: input.partial.length + 1,
    suggestions: matchingCommandNames({ input, custom }),
  };
};

const matchingCommandNames = (parts: {
  readonly input: CommandNameSuggestionsInput;
  readonly custom: Awaited<ReturnType<typeof loadCustomCommands>>;
}): InputSuggestion[] => {
  const builtIns = parts.input.commands.map((command) => ({
    value: `/${command.name} `,
    label: `/${command.name}`,
    kind: "command" as const,
    detail: command.description,
  }));
  const customSuggestions = parts.custom.map((command) => {
    const detail =
      command.description === undefined ? `${command.source} custom command` : command.description;
    return {
      value: `/${command.name} `,
      label: `/${command.name}`,
      kind: "command" as const,
      detail,
    };
  });
  const query = parts.input.partial.toLowerCase();
  const limit = suggestionLimit(parts.input.options.limit);
  return [...builtIns, ...customSuggestions]
    .filter((suggestion) => suggestion.label.slice(1).toLowerCase().startsWith(query))
    .slice(0, limit);
};
