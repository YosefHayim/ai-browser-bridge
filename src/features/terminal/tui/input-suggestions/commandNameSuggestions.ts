import type { CommandDef } from "../../../domain/types.ts";
import { loadCustomCommands } from "../../../user-config/hooks.ts";
import type {
  InputSuggestion,
  InputSuggestionGroup,
  LoadInputSuggestionsOptions,
} from "./types.ts";
import { DEFAULT_SUGGESTION_LIMIT } from "./types.ts";

/** Inputs for building slash command name suggestions. */
interface CommandNameSuggestionsParams {
  partial: string;
  commands: readonly CommandDef[];
  options: LoadInputSuggestionsOptions;
}

/** Build autocomplete suggestions for an in-progress slash command name. */
export async function commandNameSuggestions(
  params: CommandNameSuggestionsParams,
): Promise<InputSuggestionGroup | null> {
  const custom = await loadCustomCommands({
    repoRoot: params.options.repoRoot,
    homeDir: params.options.customCommandsHomeDir,
  });
  const suggestions = buildCommandNameSuggestions({ params, custom });
  return {
    title: "Commands",
    hint: "Tab inserts the first command. Enter runs the selected command.",
    replacementStart: 0,
    replacementEnd: params.partial.length + 1,
    suggestions,
  };
}

/** Merge built-in and custom command suggestions filtered by partial input. */
function buildCommandNameSuggestions(input: {
  params: CommandNameSuggestionsParams;
  custom: Awaited<ReturnType<typeof loadCustomCommands>>;
}): InputSuggestion[] {
  const builtIns = input.params.commands.map((command) => ({
    value: `/${command.name} `,
    label: `/${command.name}`,
    kind: "command" as const,
    detail: command.description,
  }));
  const customSuggestions = input.custom.map((command) => ({
    value: `/${command.name} `,
    label: `/${command.name}`,
    kind: "command" as const,
    detail: command.description ?? `${command.source} custom command`,
  }));
  const query = input.params.partial.toLowerCase();
  return [...builtIns, ...customSuggestions]
    .filter((suggestion) => suggestion.label.slice(1).toLowerCase().startsWith(query))
    .slice(0, input.params.options.limit ?? DEFAULT_SUGGESTION_LIMIT);
}
