import { useCallback } from "react";
import type { InputMode } from "../shell/appTypes.ts";
import { ESCAPE_CONTROL } from "./composerConstants.ts";
import type { ComposerState } from "./useComposerState.ts";

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
      if (stripEscapeControl({ state, value })) return;
      applyInputValue({ state, value });
    },
    [state],
  );
};

const stripEscapeControl = (input: { state: ComposerState; value: string }) => {
  if (!input.value.includes(ESCAPE_CONTROL)) return false;
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
  if (mode === "command-list") input.state.setSelectedIdx(0);
};

const inputModeFrom = (value: string): InputMode => {
  if (!value.startsWith("/")) return "typing";
  if (!value.includes(" ")) return "command-list";
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
  if (consumeSuppressedSubmit(input.state)) return;
  const trimmed = input.value.trim();
  if (trimmed === "" || trimmed === "/") {
    clearSlashOnly(input.state);
    return;
  }
  await runSubmittedPrompt({ state: input.state, runCommand: input.runCommand, trimmed });
};

const consumeSuppressedSubmit = (state: ComposerState): boolean => {
  if (!state.refs.suppressNextSubmit.current) return false;
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
