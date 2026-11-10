import { useCallback } from "react";
import type { PromptSendReport } from "@/terminal/tui/shell/app-types.ts";
import type { ComposerStatus } from "./use-composer-state.ts";

export type SendPromptSettings = {
  readonly state: ComposerStatus;
  readonly sendMessage: (message: string) => Promise<void>;
};

export const useComposerSend = (settings: SendPromptSettings) => {
  const { state: status, sendMessage } = settings;
  return useCallback(
    async (prompt: string): Promise<PromptSendReport> => {
      const isSendInProgress = status.refs.sendInProgress.current;
      if (isSendInProgress) return queuePrompt({ state: status, prompt });

      return flushPromptQueue({ state: status, prompt, sendMessage });
    },
    [sendMessage, status],
  );
};

const queuePrompt = async (details: {
  state: ComposerStatus;
  prompt: string;
}): Promise<PromptSendReport> => {
  const queue = details.state.refs.queuedPromptRef.current;
  queue.push(details.prompt);
  details.state.setQueuedPrompt(details.prompt);

  const queuedStatusMessage = createQueueStatusMessage(queue.length);
  details.state.setStatus(queuedStatusMessage);
  return "queued";
};

const createQueueStatusMessage = (queuedCount: number): string => {
  const isSingleQueuedMessage = queuedCount === 1;
  if (isSingleQueuedMessage) {
    return "Queued prompt; it will send after the current response starts.";
  }

  return `Queued ${queuedCount} prompts; they will send in order.`;
};

const flushPromptQueue = async (details: {
  state: ComposerStatus;
  prompt: string;
  sendMessage: (message: string) => Promise<void>;
}): Promise<PromptSendReport> => {
  details.state.refs.sendInProgress.current = true;

  try {
    await sendQueuedPrompts(details);
    details.state.setStatus("Ready");
    return "sent";
  } finally {
    details.state.refs.sendInProgress.current = false;
  }
};

const sendQueuedPrompts = async (details: {
  state: ComposerStatus;
  prompt: string;
  sendMessage: (message: string) => Promise<void>;
}) => {
  const queue = details.state.refs.queuedPromptRef.current;
  let currentPrompt: string | null = details.prompt;

  while (currentPrompt != null) {
    details.state.setStatus("Sending...");
    await details.sendMessage(currentPrompt);

    const nextPrompt = queue.shift();

    const isNextPromptMissing = nextPrompt == null;
    if (isNextPromptMissing) {
      currentPrompt = null;
      details.state.setQueuedPrompt(null);
      continue;
    }

    currentPrompt = nextPrompt;
    details.state.setQueuedPrompt(currentPrompt);
  }
  clearQueuedPrompt(details.state);
};

const clearQueuedPrompt = (status: ComposerStatus) => {
  status.refs.queuedPromptRef.current.length = 0;
  status.setQueuedPrompt(null);
};
