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
  CommandSuggestionRule,
  InputSuggestion,
  InputSuggestionGroup,
  LoadInputSuggestionsOptions,
  ParsedSlashInput,
} from "./types.ts";

export const commandArgumentSuggestions = async (
  slash: ParsedSlashInput,
  options: LoadInputSuggestionsOptions,
): Promise<InputSuggestionGroup> => {
  const knownRule = COMMAND_SUGGESTION_RULES[slash.command];
  const rule =
    knownRule === undefined
      ? {
          title: `/${slash.command}`,
          hint: "Type arguments for this command. Use @ to mention repo files.",
        }
      : knownRule;
  const token = activeArgumentToken(slash);
  const base: InputSuggestionGroup = {
    title: rule.title,
    hint: rule.hint,
    replacementStart: token.start,
    replacementEnd: token.end,
    suggestions: [],
  };
  return dispatchCommandArgumentSuggestions({ slash, options, rule, base, token });
};

type DispatchCommandArgumentSuggestionsInput = {
  readonly slash: ParsedSlashInput;
  readonly options: LoadInputSuggestionsOptions;
  readonly rule: CommandSuggestionRule;
  readonly base: InputSuggestionGroup;
  readonly token: ReturnType<typeof activeArgumentToken>;
};

const dispatchCommandArgumentSuggestions = async (
  input: DispatchCommandArgumentSuggestionsInput,
): Promise<InputSuggestionGroup> => {
  const handler = COMMAND_ARG_HANDLERS[input.slash.command];
  if (handler !== undefined) return handler(input);
  return withFilteredSuggestions({
    group: input.base,
    suggestions: ruleValues(input.rule),
    query: input.token.value,
    limit: input.options.limit,
  });
};

const ruleValues = (rule: CommandSuggestionRule): readonly InputSuggestion[] => {
  if (rule.values === undefined) return [];
  return rule.values;
};

const filteredRuleValues = (
  input: DispatchCommandArgumentSuggestionsInput,
): Promise<InputSuggestionGroup> => {
  return Promise.resolve(
    withFilteredSuggestions({
      group: input.base,
      suggestions: ruleValues(input.rule),
      query: input.token.value,
      limit: input.options.limit,
    }),
  );
};

const COMMAND_ARG_HANDLERS: Record<
  string,
  (input: DispatchCommandArgumentSuggestionsInput) => Promise<InputSuggestionGroup>
> = {
  resume: (input) => filteredResumeSuggestions(input),
  open: (input) => filteredResumeSuggestions(input),
  transcript: (input) => filteredSessionSuggestions(input),
  copy: (input) => filteredSessionSuggestions(input),
  export: (input) =>
    exportArgumentSuggestions({
      slash: input.slash,
      options: input.options,
      base: input.base,
      token: input.token,
    }),
  permissions: (input) => filteredRuleValues(input),
  model: (input) =>
    Promise.resolve(
      withFilteredSuggestions({
        group: input.base,
        suggestions: modelSuggestions(),
        query: input.token.value,
        limit: input.options.limit,
      }),
    ),
  restore: (input) =>
    restoreArgumentSuggestions({
      slash: input.slash,
      options: input.options,
      base: input.base,
      token: input.token,
    }),
  rewind: (input) =>
    rewindArgumentSuggestions({
      slash: input.slash,
      options: input.options,
      base: input.base,
      token: input.token,
    }),
  retry: (input) =>
    rewindArgumentSuggestions({
      slash: input.slash,
      options: input.options,
      base: input.base,
      token: input.token,
    }),
  review: (input) => filteredRuleValues(input),
  "attach-image": (input) =>
    pathSuggestionGroup({
      base: input.base,
      partial: input.token.value,
      options: input.options,
      kind: "image",
    }),
  screenshot: (input) => filteredRuleValues(input),
  "ui-qa": (input) => filteredRuleValues(input),
  task: (input) =>
    Promise.resolve({
      ...input.base,
      replacementStart: undefined,
      replacementEnd: undefined,
      hint: "Describe the coding task. Type @ to see repo files and folders.",
    }),
  work: (input) =>
    Promise.resolve({
      ...input.base,
      replacementStart: undefined,
      replacementEnd: undefined,
      hint: "Describe the coding task. Type @ to see repo files and folders.",
    }),
};

const filteredResumeSuggestions = async (
  input: DispatchCommandArgumentSuggestionsInput,
): Promise<InputSuggestionGroup> => {
  return withFilteredSuggestions({
    group: input.base,
    suggestions: await resumeSessionSuggestions(input.options),
    query: input.token.value,
    limit: input.options.limit,
  });
};

const filteredSessionSuggestions = async (
  input: DispatchCommandArgumentSuggestionsInput,
): Promise<InputSuggestionGroup> => {
  return withFilteredSuggestions({
    group: input.base,
    suggestions: await sessionSuggestions(input.options),
    query: input.token.value,
    limit: input.options.limit,
  });
};
