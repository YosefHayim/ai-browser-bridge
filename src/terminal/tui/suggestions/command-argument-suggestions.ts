import {
  exportArgumentSuggestions,
  filterTokenSuggestions,
  readRewindArgumentSuggestions,
  restoreArgumentSuggestions,
} from "./command-arg-handlers.ts";
import { COMMAND_SUGGESTION_RULES } from "./command-rules.ts";
import { readActiveArgumentToken } from "./parse-slash-input.ts";
import { readPathSuggestionGroup } from "./path-suggestions.ts";
import {
  listModelSuggestions,
  listSessionSuggestions,
  resumeSessionSuggestions,
} from "./session-checkpoint-suggestions.ts";
import type {
  CommandSuggestionRule,
  LoadPromptSuggestionsSettings,
  ParsedSlashLine,
  PromptSuggestion,
  PromptSuggestionGroup,
} from "./types.ts";

const TASK_ARGUMENT_HINT = "Describe the coding task. Type @ to see repo files and folders.";

export const readCommandArgumentSuggestions = async (
  slash: ParsedSlashLine,
  settings: LoadPromptSuggestionsSettings,
): Promise<PromptSuggestionGroup> => {
  const knownRule = COMMAND_SUGGESTION_RULES[slash.command];
  const isKnownRuleMissing = knownRule == null;
  const rule = isKnownRuleMissing
    ? {
        title: `/${slash.command}`,
        hint: "Type arguments for this command. Use @ to mention repo files.",
      }
    : knownRule;
  const token = readActiveArgumentToken(slash);
  const base: PromptSuggestionGroup = {
    title: rule.title,
    hint: rule.hint,
    replacementStart: token.start,
    replacementEnd: token.end,
    suggestions: [],
  };

  return dispatchCommandArgumentSuggestions({ slash, options: settings, rule, base, token });
};

type DispatchCommandArgumentSuggestionsDetails = {
  readonly slash: ParsedSlashLine;
  readonly options: LoadPromptSuggestionsSettings;
  readonly rule: CommandSuggestionRule;
  readonly base: PromptSuggestionGroup;
  readonly token: ReturnType<typeof readActiveArgumentToken>;
};

const dispatchCommandArgumentSuggestions = async (
  details: DispatchCommandArgumentSuggestionsDetails,
): Promise<PromptSuggestionGroup> => {
  const handler = COMMAND_ARG_HANDLERS[details.slash.command];

  const hasHandler = handler != null;
  if (hasHandler) return handler(details);

  const ruleSuggestions = listRuleFields(details.rule);
  return filterTokenSuggestions(details, ruleSuggestions);
};

const listRuleFields = (rule: CommandSuggestionRule): readonly PromptSuggestion[] => {
  const isRuleSuggestionsMissing = rule.values == null;
  if (isRuleSuggestionsMissing) return [];

  return rule.values;
};

const readFilteredRuleFields = (
  details: DispatchCommandArgumentSuggestionsDetails,
): Promise<PromptSuggestionGroup> => {
  const ruleSuggestions = listRuleFields(details.rule);
  const filteredGroup = filterTokenSuggestions(details, ruleSuggestions);
  return Promise.resolve(filteredGroup);
};

const readFilteredModelSuggestions = (
  details: DispatchCommandArgumentSuggestionsDetails,
): Promise<PromptSuggestionGroup> => {
  const modelSuggestions = listModelSuggestions();
  const filteredGroup = filterTokenSuggestions(details, modelSuggestions);
  return Promise.resolve(filteredGroup);
};

const COMMAND_ARG_HANDLERS: Record<
  string,
  (details: DispatchCommandArgumentSuggestionsDetails) => Promise<PromptSuggestionGroup>
> = {
  resume: (details) => readFilteredResumeSuggestions(details),
  open: (details) => readFilteredResumeSuggestions(details),
  transcript: (details) => readFilteredSessionSuggestions(details),
  copy: (details) => readFilteredSessionSuggestions(details),
  export: (details) =>
    exportArgumentSuggestions({
      slash: details.slash,
      options: details.options,
      base: details.base,
      token: details.token,
    }),
  permissions: (details) => readFilteredRuleFields(details),
  model: (details) => readFilteredModelSuggestions(details),
  restore: (details) =>
    restoreArgumentSuggestions({
      slash: details.slash,
      options: details.options,
      base: details.base,
      token: details.token,
    }),
  rewind: (details) =>
    readRewindArgumentSuggestions({
      slash: details.slash,
      options: details.options,
      base: details.base,
      token: details.token,
    }),
  retry: (details) =>
    readRewindArgumentSuggestions({
      slash: details.slash,
      options: details.options,
      base: details.base,
      token: details.token,
    }),
  review: (details) => readFilteredRuleFields(details),
  "attach-image": (details) =>
    readPathSuggestionGroup({
      base: details.base,
      partial: details.token.value,
      options: details.options,
      kind: "image",
    }),
  screenshot: (details) => readFilteredRuleFields(details),
  "ui-qa": (details) => readFilteredRuleFields(details),
  task: (details) =>
    Promise.resolve({
      ...details.base,
      replacementStart: null,
      replacementEnd: null,
      hint: TASK_ARGUMENT_HINT,
    }),
  work: (details) =>
    Promise.resolve({
      ...details.base,
      replacementStart: null,
      replacementEnd: null,
      hint: TASK_ARGUMENT_HINT,
    }),
};

const readFilteredResumeSuggestions = async (
  details: DispatchCommandArgumentSuggestionsDetails,
): Promise<PromptSuggestionGroup> => {
  const resumeSuggestions = await resumeSessionSuggestions(details.options);
  return filterTokenSuggestions(details, resumeSuggestions);
};

const readFilteredSessionSuggestions = async (
  details: DispatchCommandArgumentSuggestionsDetails,
): Promise<PromptSuggestionGroup> => {
  const sessionSuggestions = await listSessionSuggestions(details.options);
  return filterTokenSuggestions(details, sessionSuggestions);
};
