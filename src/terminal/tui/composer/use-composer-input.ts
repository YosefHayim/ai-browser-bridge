import { useCallback } from "react";
import type { InputMode } from "@/terminal/tui/shell/app-types.ts";
import { ESCAPE_CONTROL } from "./composer-constants.ts";
import type { ComposerState } from "./use-composer-state.ts";

export type ComposerInputHandlersOptions = {
  readonly state: ComposerState;
  readonly runCommand: (commandText: string) => Promise<void>;
};

export const useComposerInputHandlers = (options: ComposerInputHandlersOptions) => {
  const handleInputChange = useHandleInputChange(options.state);
  const handleSubmit = useHandleSubmit(options);
  return { handleInputChange, handleSubmit };
};

const useHandleInputChange = (state: ComposerState) => {
  return useCallback(
    (value: string) => {
      const isEscapeConsumed = stripEscapeControl({ state, value });
      if (isEscapeConsumed) return;

      applyInputValue({ state, value });
    },
    [state],
  );
};

const stripEscapeControl = (input: { state: ComposerState; value: string }) => {
  const isEscapeControlAbsent = !input.value.includes(ESCAPE_CONTROL);
  if (isEscapeControlAbsent) return false;

  input.state.setInput(input.value.replaceAll(ESCAPE_CONTROL, ""));
  return true;
};

const applyInputValue = (input: { state: ComposerState; value: string }) => {
  input.state.refs.lastEscapeAt.current = 0;
  input.state.setInput(input.value);
  updateInputMode({ state: input.state, value: input.value });
};

const updateInputMode = (input: { state: ComposerState; value: string }) => {
  const mode = inputModeFrom(input.value);
  input.state.setMode(mode);

  const isModeCommandList = mode === "command-list";
  if (isModeCommandList) input.state.setSelectedIdx(0);
};

const inputModeFrom = (value: string): InputMode => {
  const isNotSlashCommand = !value.startsWith("/");
  if (isNotSlashCommand) return "typing";

  const isNotEmptyIn = !value.includes(" ");
  if (isNotEmptyIn) return "command-list";

  return "typing";
};

const useHandleSubmit = (options: ComposerInputHandlersOptions) => {
  const { state, runCommand } = options;
  return useCallback(
    async (value: string) => {
      await submitComposerInput({ state, runCommand, value });
    },
    [runCommand, state],
  );
};

const submitComposerInput = async (input: {
  state: ComposerState;
  runCommand: (commandText: string) => Promise<void>;
  value: string;
}): Promise<void> => {
  const isSubmitSuppressed = consumeSuppressedSubmit(input.state);
  if (isSubmitSuppressed) return;

  const trimmed = input.value.trim();
  const isTrimmedEmpty = trimmed === "" || trimmed === "/";
  if (isTrimmedEmpty) {
    clearSlashOnly(input.state);
    return;
  }

  await runSubmittedPrompt({ state: input.state, runCommand: input.runCommand, trimmed });
};

const consumeSuppressedSubmit = (state: ComposerState): boolean => {
  const isNotSuppressNextSubmitCurrent = !state.refs.suppressNextSubmit.current;
  if (isNotSuppressNextSubmitCurrent) return false;

  state.refs.suppressNextSubmit.current = false;
  return true;
};

const runSubmittedPrompt = async (input: {
  state: ComposerState;
  runCommand: (commandText: string) => Promise<void>;
  trimmed: string;
}): Promise<void> => {
  input.state.refs.history.current.add(input.trimmed);
  input.state.setInput("");
  input.state.setMode("typing");
  await input.runCommand(input.trimmed);
};

const clearSlashOnly = (state: ComposerState) => {
  state.setInput("");
  state.setMode("typing");
};
