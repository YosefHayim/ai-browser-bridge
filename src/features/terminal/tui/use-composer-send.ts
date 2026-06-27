import { useCallback } from "react";
import type { PromptSendResult } from "./app-types.ts";
import type { ComposerState } from "./use-composer-state.ts";

/** Options for sending or queueing a prompt. */
export type SendPromptOptions = {
  /** Composer state container. */
  state: ComposerState;
  /** Remote send function. */
  sendMessage: (content: string) => Promise<void>;
};

/** Creates the enqueue-or-send prompt handler. */
export function useComposerSend(options: SendPromptOptions) {
  const { state, sendMessage } = options;
  return useCallback(async (prompt: string): Promise<PromptSendResult> => {
    if (state.refs.sendInProgress.current) return queuePrompt({ state, prompt });
    return flushPromptQueue({ state, prompt, sendMessage });
  }, [sendMessage, state]);
}

async function queuePrompt(input: { state: ComposerState; prompt: string }): Promise<PromptSendResult> {
  input.state.refs.queuedPromptRef.current = input.prompt;
  input.state.setQueuedPrompt(input.prompt);
  input.state.setStatus("Queued prompt; it will send after the current response starts.");
  return "queued";
}

async function flushPromptQueue(input: {
  state: ComposerState;
  prompt: string;
  sendMessage: (content: string) => Promise<void>;
}): Promise<PromptSendResult> {
  input.state.refs.sendInProgress.current = true;
  try {
    await drainPromptQueue(input);
    input.state.setStatus("Ready");
    return "sent";
  } finally {
    input.state.refs.sendInProgress.current = false;
  }
}

async function drainPromptQueue(input: {
  state: ComposerState;
  prompt: string;
  sendMessage: (content: string) => Promise<void>;
}) {
  let nextPrompt: string | null = input.prompt;
  while (nextPrompt) {
    const currentPrompt = nextPrompt;
    nextPrompt = null;
    clearQueuedPrompt(input.state);
    input.state.setStatus("Sending...");
    await input.sendMessage(currentPrompt);
    nextPrompt = input.state.refs.queuedPromptRef.current;
  }
}

function clearQueuedPrompt(state: ComposerState) {
  state.refs.queuedPromptRef.current = null;
  state.setQueuedPrompt(null);
}
