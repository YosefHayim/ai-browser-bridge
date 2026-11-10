import { useCallback } from "react";
import type { PromptMode } from "@/terminal/tui/shell/app-types.ts";
import { ESCAPE_CONTROL } from "./composer-constants.ts";
import { addPrompt } from "./composer-history.ts";
import type { ComposerStatus } from "./use-composer-state.ts";

const COMMAND_PREFIX = "/";
const COMMAND_LIST_MODE = "command-list";
const TYPING_MODE = "typing";

export type ComposerPromptHandlersSettings = {
  readonly state: ComposerStatus;
  readonly runCommand: (commandString: string) => Promise<void>;
};

export const useComposerPromptHandlers = (settings: ComposerPromptHandlersSettings) => {
  const handlePromptChange = usePromptChange(settings.state);
  const handleSubmit = useHandleSubmit(settings);
  return { handleInputChange: handlePromptChange, handleSubmit };
};

const usePromptChange = (status: ComposerStatus) => {
  return useCallback(
    (field: string) => {
      const isEscapeConsumed = removeEscapeControl({ state: status, value: field });
      if (isEscapeConsumed) return;

      applyPromptField({ state: status, value: field });
    },
    [status],
  );
};

const removeEscapeControl = (details: { state: ComposerStatus; value: string }) => {
  const isEscapeControlAbsent = !details.value.includes(ESCAPE_CONTROL);
  if (isEscapeControlAbsent) return false;

  const promptWithoutEscape = details.value.replaceAll(ESCAPE_CONTROL, "");
  details.state.setInput(promptWithoutEscape);
  return true;
};

const applyPromptField = (details: { state: ComposerStatus; value: string }) => {
  details.state.refs.lastEscapeAt.current = 0;
  details.state.setInput(details.value);
  updatePromptMode({ state: details.state, value: details.value });
};

const updatePromptMode = (details: { state: ComposerStatus; value: string }) => {
  const mode = readPromptMode(details.value);
  details.state.setMode(mode);

  const isModeCommandList = mode === COMMAND_LIST_MODE;
  if (isModeCommandList) details.state.setSelectedIndex(0);
};

const readPromptMode = (field: string): PromptMode => {
  const isNotSlashCommand = !field.startsWith(COMMAND_PREFIX);
  if (isNotSlashCommand) return TYPING_MODE;

  const hasNoArgumentsYet = !field.includes(" ");
  if (hasNoArgumentsYet) return COMMAND_LIST_MODE;

  return TYPING_MODE;
};

const useHandleSubmit = (settings: ComposerPromptHandlersSettings) => {
  const { state: status, runCommand } = settings;

  return useCallback(
    async (field: string) => {
      await submitComposerPrompt({ state: status, runCommand, value: field });
    },
    [runCommand, status],
  );
};

const submitComposerPrompt = async (details: {
  state: ComposerStatus;
  runCommand: (commandString: string) => Promise<void>;
  value: string;
}): Promise<void> => {
  const isSubmitSuppressed = consumeSuppressedSubmit(details.state);
  if (isSubmitSuppressed) return;

  const trimmed = details.value.trim();

  const isTrimmedEmpty = trimmed === "" || trimmed === COMMAND_PREFIX;
  if (isTrimmedEmpty) {
    clearSlashOnly(details.state);
    return;
  }

  await submitTypedPrompt({ state: details.state, runCommand: details.runCommand, trimmed });
};

const consumeSuppressedSubmit = (status: ComposerStatus): boolean => {
  const isNotSuppressNextSubmitCurrent = !status.refs.suppressNextSubmit.current;
  if (isNotSuppressNextSubmitCurrent) return false;

  status.refs.suppressNextSubmit.current = false;
  return true;
};

const submitTypedPrompt = async (details: {
  state: ComposerStatus;
  runCommand: (commandString: string) => Promise<void>;
  trimmed: string;
}): Promise<void> => {
  const historyWithSubmittedPrompt = addPrompt(details.state.refs.history.current, details.trimmed);
  details.state.refs.history.current = historyWithSubmittedPrompt;

  details.state.setInput("");
  details.state.setMode(TYPING_MODE);
  await details.runCommand(details.trimmed);
};

const clearSlashOnly = (status: ComposerStatus) => {
  status.setInput("");
  status.setMode(TYPING_MODE);
};
