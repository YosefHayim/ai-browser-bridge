import {
  exportArgumentSuggestions,
  restoreArgumentSuggestions,
  rewindArgumentSuggestions,
} from "./commandArgHandlers.ts";
import { COMMAND_SUGGESTION_RULES } from "./commandRules.ts";
import { withFilteredSuggestions } from "./filterSuggestions.ts";
import { activeArgumentToken } from "./parseSlashInput.ts";
import { pathSuggestionGroup } from "./pathSuggestions.ts";
import {
  modelSuggestions,
  resumeSessionSuggestions,
  sessionSuggestions,
} from "./sessionCheckpointSuggestions.ts";
import type {
  InputSuggestionGroup,
  LoadInputSuggestionsOptions,
  ParsedSlashInput,
} from "./types.ts";

/** Build autocomplete suggestions for slash command arguments. */
export async function commandArgumentSuggestions(
  slash: ParsedSlashInput,
  options: LoadInputSuggestionsOptions,
): Promise<InputSuggestionGroup | null> {
  const rule = COMMAND_SUGGESTION_RULES[slash.command] ?? {
    title: `/${slash.command}`,
    hint: "Type arguments for this command. Use @ to mention repo files.",
  };
  const token = activeArgumentToken(slash);
  const base: InputSuggestionGroup = {
    title: rule.title,
    hint: rule.hint,
    replacementStart: token.start,
    replacementEnd: token.end,
    suggestions: [],
  };
  return dispatchCommandArgumentSuggestions({ slash, options, rule, base, token });
}

/** Inputs for dispatching command-specific argument suggestions. */
interface DispatchCommandArgumentSuggestionsParams {
  slash: ParsedSlashInput;
  options: LoadInputSuggestionsOptions;
  rule: { title: string; hint: string; values?: readonly import("./types.ts").InputSuggestion[] };
  base: InputSuggestionGroup;
  token: ReturnType<typeof activeArgumentToken>;
}

/** Route to the handler for the active slash command's arguments. */
async function dispatchCommandArgumentSuggestions(
  params: DispatchCommandArgumentSuggestionsParams,
): Promise<InputSuggestionGroup | null> {
  const handler = COMMAND_ARG_HANDLERS[params.slash.command];
  if (handler) return handler(params);
  return withFilteredSuggestions({
    group: params.base,
    suggestions: params.rule.values ?? [],
    query: params.token.value,
    limit: params.options.limit,
  });
}

/** Per-command argument suggestion handlers. */
const COMMAND_ARG_HANDLERS: Record<
  string,
  (params: DispatchCommandArgumentSuggestionsParams) => Promise<InputSuggestionGroup | null>
> = {
  resume: (p) => filteredResumeSuggestions(p),
  open: (p) => filteredResumeSuggestions(p),
  transcript: (p) => filteredSessionSuggestions(p),
  copy: (p) => filteredSessionSuggestions(p),
  export: (p) =>
    exportArgumentSuggestions({ slash: p.slash, options: p.options, base: p.base, token: p.token }),
  permissions: (p) =>
    Promise.resolve(
      withFilteredSuggestions({
        group: p.base,
        suggestions: p.rule.values ?? [],
        query: p.token.value,
        limit: p.options.limit,
      }),
    ),
  model: (p) =>
    Promise.resolve(
      withFilteredSuggestions({
        group: p.base,
        suggestions: modelSuggestions(p.options),
        query: p.token.value,
        limit: p.options.limit,
      }),
    ),
  restore: (p) =>
    restoreArgumentSuggestions({
      slash: p.slash,
      options: p.options,
      base: p.base,
      token: p.token,
    }),
  rewind: (p) =>
    rewindArgumentSuggestions({ slash: p.slash, options: p.options, base: p.base, token: p.token }),
  retry: (p) =>
    rewindArgumentSuggestions({ slash: p.slash, options: p.options, base: p.base, token: p.token }),
  review: (p) =>
    Promise.resolve(
      withFilteredSuggestions({
        group: p.base,
        suggestions: p.rule.values ?? [],
        query: p.token.value,
        limit: p.options.limit,
      }),
    ),
  "attach-image": (p) =>
    pathSuggestionGroup({
      base: p.base,
      partial: p.token.value,
      options: p.options,
      kind: "image",
    }),
  screenshot: (p) =>
    Promise.resolve(
      withFilteredSuggestions({
        group: p.base,
        suggestions: p.rule.values ?? [],
        query: p.token.value,
        limit: p.options.limit,
      }),
    ),
  "ui-qa": (p) =>
    Promise.resolve(
      withFilteredSuggestions({
        group: p.base,
        suggestions: p.rule.values ?? [],
        query: p.token.value,
        limit: p.options.limit,
      }),
    ),
  task: (p) =>
    Promise.resolve({
      ...p.base,
      replacementStart: undefined,
      replacementEnd: undefined,
      hint: "Describe the coding task. Type @ to see repo files and folders.",
    }),
  work: (p) =>
    Promise.resolve({
      ...p.base,
      replacementStart: undefined,
      replacementEnd: undefined,
      hint: "Describe the coding task. Type @ to see repo files and folders.",
    }),
};

/** Filter resume/open session suggestions. */
async function filteredResumeSuggestions(
  params: DispatchCommandArgumentSuggestionsParams,
): Promise<InputSuggestionGroup> {
  return withFilteredSuggestions({
    group: params.base,
    suggestions: await resumeSessionSuggestions(params.options),
    query: params.token.value,
    limit: params.options.limit,
  });
}

/** Filter transcript/copy session suggestions. */
async function filteredSessionSuggestions(
  params: DispatchCommandArgumentSuggestionsParams,
): Promise<InputSuggestionGroup> {
  return withFilteredSuggestions({
    group: params.base,
    suggestions: await sessionSuggestions(params.options),
    query: params.token.value,
    limit: params.options.limit,
  });
}
