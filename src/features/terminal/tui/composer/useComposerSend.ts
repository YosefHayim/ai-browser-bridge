import { useCallback } from "react";
import type { PromptSendResult } from "../shell/appTypes.ts";
import type { ComposerState } from "./useComposerState.ts";

export type SendPromptOptions = {
  readonly state: ComposerState;
  readonly sendMessage: (content: string) => Promise<void>;
};

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
  input.state.setStatus(queueStatusMessage(queue.length));
  return "queued";
};

const queueStatusMessage = (queuedCount: number): string => {
  if (queuedCount === 1) {
    return "Queued prompt; it will send after the current response starts.";
  }
  return `Queued ${queuedCount} prompts; they will send in order.`;
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
  let currentPrompt: string | undefined = input.prompt;
  while (currentPrompt !== undefined) {
    input.state.setStatus("Sending...");
    await input.sendMessage(currentPrompt);
    const nextPrompt = queue.shift();
    if (nextPrompt === undefined) {
      currentPrompt = undefined;
      input.state.setQueuedPrompt(null);
      continue;
    }
    currentPrompt = nextPrompt;
    input.state.setQueuedPrompt(currentPrompt);
  }
  clearQueuedPrompt(input.state);
};

const clearQueuedPrompt = (state: ComposerState) => {
  state.refs.queuedPromptRef.current.length = 0;
  state.setQueuedPrompt(null);
};
