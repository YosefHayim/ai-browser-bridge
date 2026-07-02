import { useCallback } from "react";
import type { InputMode } from "./appTypes.ts";
import { ESCAPE_CONTROL } from "./composerConstants.ts";
import type { ComposerState } from "./useComposerState.ts";

/** Options for composer text input handlers. */
export type ComposerInputHandlersOptions = {
  /** Composer state container. */
  state: ComposerState;
  /** Slash command runner. */
  runCommand: (cmd: string) => Promise<void>;
};

/** Creates input change and submit handlers. */
export function useComposerInputHandlers(options: ComposerInputHandlersOptions) {
  const handleInputChange = useHandleInputChange(options.state);
  const handleSubmit = useHandleSubmit(options);
  return { handleInputChange, handleSubmit };
}

function useHandleInputChange(state: ComposerState) {
  return useCallback(
    (value: string) => {
      if (stripEscapeControl({ state, value })) return;
      applyInputValue({ state, value });
    },
    [state],
  );
}

function stripEscapeControl(input: { state: ComposerState; value: string }) {
  if (!input.value.includes(ESCAPE_CONTROL)) return false;
  input.state.setInput(input.value.replaceAll(ESCAPE_CONTROL, ""));
  return true;
}

function applyInputValue(input: { state: ComposerState; value: string }) {
  input.state.refs.lastEscapeAt.current = 0;
  input.state.setInput(input.value);
  updateInputMode({ state: input.state, value: input.value });
}

function updateInputMode(input: { state: ComposerState; value: string }) {
  const mode = resolveInputMode(input.value);
  input.state.setMode(mode);
  if (mode === "command-list") input.state.setSelectedIdx(0);
}

function resolveInputMode(value: string): InputMode {
  if (!value.startsWith("/")) return "typing";
  if (!value.includes(" ")) return "command-list";
  return "typing";
}

function useHandleSubmit(options: ComposerInputHandlersOptions) {
  const { state, runCommand } = options;
  return useCallback(
    async (value: string) => {
      await submitComposerInput({ state, runCommand, value });
    },
    [runCommand, state],
  );
}

/** Handle one composer submit, including history and slash-only clears. */
async function submitComposerInput(input: {
  state: ComposerState;
  runCommand: (cmd: string) => Promise<void>;
  value: string;
}): Promise<void> {
  if (consumeSuppressedSubmit(input.state)) return;
  const trimmed = input.value.trim();
  if (!trimmed || trimmed === "/") return clearSlashOnly(input.state);
  await runSubmittedPrompt({ state: input.state, runCommand: input.runCommand, trimmed });
}

/** Skip submit when the previous menu selection already dispatched a command. */
function consumeSuppressedSubmit(state: ComposerState): boolean {
  if (!state.refs.suppressNextSubmit.current) return false;
  state.refs.suppressNextSubmit.current = false;
  return true;
}

/** Record history and dispatch a trimmed prompt. */
async function runSubmittedPrompt(input: {
  state: ComposerState;
  runCommand: (cmd: string) => Promise<void>;
  trimmed: string;
}): Promise<void> {
  input.state.refs.history.current.add(input.trimmed);
  input.state.setInput("");
  input.state.setMode("typing");
  await input.runCommand(input.trimmed);
}

function clearSlashOnly(state: ComposerState) {
  state.setInput("");
  state.setMode("typing");
}
