import type { CommandDef } from "@/domain/command-types.ts";
import { loadCustomCommands } from "@/user-config/custom-commands.ts";
import type {
  InputSuggestion,
  InputSuggestionGroup,
  LoadInputSuggestionsOptions,
} from "./types.ts";
import { readSuggestionLimit } from "./types.ts";

type CommandNameSuggestionsInput = {
  readonly partial: string;
  readonly commands: readonly CommandDef[];
  readonly options: LoadInputSuggestionsOptions;
};

export const readCommandNameSuggestions = async (
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
    suggestions: listMatchingCommandNames({ input, custom }),
  };
};

const listMatchingCommandNames = (parts: {
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
    const isCommandDescriptionMissing = command.description === undefined;
    const detail = isCommandDescriptionMissing
      ? `${command.source} custom command`
      : command.description;
    return {
      value: `/${command.name} `,
      label: `/${command.name}`,
      kind: "command" as const,
      detail,
    };
  });
  const query = parts.input.partial.toLowerCase();
  const limit = readSuggestionLimit(parts.input.options.limit);
  return [...builtIns, ...customSuggestions]
    .filter((suggestion) => suggestion.label.slice(1).toLowerCase().startsWith(query))
    .slice(0, limit);
};
