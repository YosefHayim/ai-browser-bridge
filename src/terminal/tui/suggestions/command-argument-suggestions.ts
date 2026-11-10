import {
  exportArgumentSuggestions,
  readRewindArgumentSuggestions,
  restoreArgumentSuggestions,
} from "./command-arg-handlers.ts";
import { COMMAND_SUGGESTION_RULES } from "./command-rules.ts";
import { filterSuggestionGroup } from "./filter-suggestions.ts";
import { readActiveArgumentToken } from "./parse-slash-input.ts";
import { readPathSuggestionGroup } from "./path-suggestions.ts";
import {
  listModelSuggestions,
  listSessionSuggestions,
  resumeSessionSuggestions,
} from "./session-checkpoint-suggestions.ts";
import type {
  CommandSuggestionRule,
  InputSuggestion,
  InputSuggestionGroup,
  LoadInputSuggestionsOptions,
  ParsedSlashInput,
} from "./types.ts";

export const readCommandArgumentSuggestions = async (
  slash: ParsedSlashInput,
  options: LoadInputSuggestionsOptions,
): Promise<InputSuggestionGroup> => {
  const knownRule = COMMAND_SUGGESTION_RULES[slash.command];
  const isKnownRuleMissing = knownRule === undefined;
  const rule = isKnownRuleMissing
    ? {
        title: `/${slash.command}`,
        hint: "Type arguments for this command. Use @ to mention repo files.",
      }
    : knownRule;
  const token = readActiveArgumentToken(slash);
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
  readonly token: ReturnType<typeof readActiveArgumentToken>;
};

const dispatchCommandArgumentSuggestions = async (
  input: DispatchCommandArgumentSuggestionsInput,
): Promise<InputSuggestionGroup> => {
  const handler = COMMAND_ARG_HANDLERS[input.slash.command];

  const hasHandler = handler !== undefined;
  if (hasHandler) return handler(input);

  return filterSuggestionGroup({
    group: input.base,
    suggestions: listRuleValues(input.rule),
    query: input.token.value,
    limit: input.options.limit,
  });
};

const listRuleValues = (rule: CommandSuggestionRule): readonly InputSuggestion[] => {
  const isRuleValuesMissing = rule.values === undefined;
  if (isRuleValuesMissing) return [];

  return rule.values;
};

const readFilteredRuleValues = (
  input: DispatchCommandArgumentSuggestionsInput,
): Promise<InputSuggestionGroup> => {
  return Promise.resolve(
    filterSuggestionGroup({
      group: input.base,
      suggestions: listRuleValues(input.rule),
      query: input.token.value,
      limit: input.options.limit,
    }),
  );
};

const COMMAND_ARG_HANDLERS: Record<
  string,
  (input: DispatchCommandArgumentSuggestionsInput) => Promise<InputSuggestionGroup>
> = {
  resume: (input) => readFilteredResumeSuggestions(input),
  open: (input) => readFilteredResumeSuggestions(input),
  transcript: (input) => readFilteredSessionSuggestions(input),
  copy: (input) => readFilteredSessionSuggestions(input),
  export: (input) =>
    exportArgumentSuggestions({
      slash: input.slash,
      options: input.options,
      base: input.base,
      token: input.token,
    }),
  permissions: (input) => readFilteredRuleValues(input),
  model: (input) =>
    Promise.resolve(
      filterSuggestionGroup({
        group: input.base,
        suggestions: listModelSuggestions(),
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
    readRewindArgumentSuggestions({
      slash: input.slash,
      options: input.options,
      base: input.base,
      token: input.token,
    }),
  retry: (input) =>
    readRewindArgumentSuggestions({
      slash: input.slash,
      options: input.options,
      base: input.base,
      token: input.token,
    }),
  review: (input) => readFilteredRuleValues(input),
  "attach-image": (input) =>
    readPathSuggestionGroup({
      base: input.base,
      partial: input.token.value,
      options: input.options,
      kind: "image",
    }),
  screenshot: (input) => readFilteredRuleValues(input),
  "ui-qa": (input) => readFilteredRuleValues(input),
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

const readFilteredResumeSuggestions = async (
  input: DispatchCommandArgumentSuggestionsInput,
): Promise<InputSuggestionGroup> => {
  return filterSuggestionGroup({
    group: input.base,
    suggestions: await resumeSessionSuggestions(input.options),
    query: input.token.value,
    limit: input.options.limit,
  });
};

const readFilteredSessionSuggestions = async (
  input: DispatchCommandArgumentSuggestionsInput,
): Promise<InputSuggestionGroup> => {
  return filterSuggestionGroup({
    group: input.base,
    suggestions: await listSessionSuggestions(input.options),
    query: input.token.value,
    limit: input.options.limit,
  });
};
