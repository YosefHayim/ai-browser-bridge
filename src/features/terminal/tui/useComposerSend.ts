import { useCallback } from "react";
import type { PromptSendResult } from "./appTypes.ts";
import type { ComposerState } from "./useComposerState.ts";

/** Options for sending or queueing a prompt. */
export type SendPromptOptions = {
  /** Composer state container. */
  state: ComposerState;
  /** Remote send callback. */
  sendMessage: (content: string) => Promise<void>;
};

/**
 * Creates the enqueue-or-send prompt handler.
 *
 * @param options - Options that configure the operation.
 * @returns The `useComposerSend` result.
 * @example
 * ```ts
 * const result = useComposerSend(options);
 * ```
 */
export const useComposerSend = (options: SendPromptOptions) => {
  const { state, sendMessage } = options;
  return useCallback(
    async (prompt: string): Promise<PromptSendResult> => {
      if (state.refs.sendInProgress.current) return queuePrompt({ state, prompt });
      return flushPromptQueue({ state, prompt, sendMessage });
    },
    [sendMessage, state],
  );
};

const queuePrompt = async (input: {
  state: ComposerState;
  prompt: string;
}): Promise<PromptSendResult> => {
  const queue = input.state.refs.queuedPromptRef.current;
  queue.push(input.prompt);
  input.state.setQueuedPrompt(input.prompt);
  input.state.setStatus(
    queue.length === 1
      ? "Queued prompt; it will send after the current response starts."
      : `Queued ${queue.length} prompts; they will send in order.`,
  );
  return "queued";
};

const flushPromptQueue = async (input: {
  state: ComposerState;
  prompt: string;
  sendMessage: (content: string) => Promise<void>;
}): Promise<PromptSendResult> => {
  input.state.refs.sendInProgress.current = true;
  try {
    await drainPromptQueue(input);
    input.state.setStatus("Ready");
    return "sent";
  } finally {
    input.state.refs.sendInProgress.current = false;
  }
};

const drainPromptQueue = async (input: {
  state: ComposerState;
  prompt: string;
  sendMessage: (content: string) => Promise<void>;
}) => {
  const queue = input.state.refs.queuedPromptRef.current;
  let currentPrompt: string | null = input.prompt;
  while (currentPrompt) {
    input.state.setStatus("Sending...");
    await input.sendMessage(currentPrompt);
    currentPrompt = queue.shift() ?? null;
    input.state.setQueuedPrompt(currentPrompt);
  }
  clearQueuedPrompt(input.state);
};

const clearQueuedPrompt = (state: ComposerState) => {
  state.refs.queuedPromptRef.current.length = 0;
  state.setQueuedPrompt(null);
};
