import { useCallback } from "react";
import { readErrorMessage } from "@/read-error-message.ts";
import type { ComposerStatus } from "@/terminal/tui/composer/use-composer-state.ts";
import type { PromptSendReport } from "@/terminal/tui/shell/app-types.ts";

export type SendPromptSettings = {
  readonly state: ComposerStatus;
  readonly sendMessage: (message: string) => Promise<void>;
};

export function useComposerSend(settings: SendPromptSettings) {
  const { state: status, sendMessage } = settings;
  return useCallback(
    async (prompt: string): Promise<PromptSendReport> => {
      const isSendInProgress = status.refs.sendInProgress.current;
      if (isSendInProgress) return queuePrompt({ state: status, prompt });

      return flushPromptQueue({ state: status, prompt, sendMessage });
    },
    [sendMessage, status],
  );
}

async function queuePrompt(details: {
  state: ComposerStatus;
  prompt: string;
}): Promise<PromptSendReport> {
  const queue = details.state.refs.queuedPromptRef.current;
  queue.push(details.prompt);
  details.state.setQueuedPrompt(details.prompt);

  const queuedStatusMessage = createQueueStatusMessage(queue.length);
  details.state.setStatus(queuedStatusMessage);
  return "queued";
}

function createQueueStatusMessage(queuedCount: number): string {
  const isSingleQueuedMessage = queuedCount === 1;
  if (isSingleQueuedMessage) {
    return "Queued prompt; it will send after the current response starts.";
  }

  return `Queued ${queuedCount} prompts; they will send in order.`;
}

async function flushPromptQueue(details: {
  state: ComposerStatus;
  prompt: string;
  sendMessage: (message: string) => Promise<void>;
}): Promise<PromptSendReport> {
  details.state.refs.sendInProgress.current = true;

  try {
    await sendQueuedPrompts(details);
    details.state.setStatus("Ready");
    return "sent";
  } catch (error: unknown) {
    const message = readErrorMessage(error);
    details.state.setStatus(`Error: ${message}`);
    console.error(message);
    return "failed";
  } finally {
    details.state.refs.sendInProgress.current = false;
  }
}

async function sendQueuedPrompts(details: {
  state: ComposerStatus;
  prompt: string;
  sendMessage: (message: string) => Promise<void>;
}) {
  const queue = details.state.refs.queuedPromptRef.current;
  const pendingPrompts = [details.prompt];

  for (const currentPrompt of pendingPrompts) {
    details.state.setStatus("Sending...");
    await details.sendMessage(currentPrompt);

    const nextPrompt = queue.shift();

    const isNextPromptMissing = nextPrompt == null;
    details.state.setQueuedPrompt(isNextPromptMissing ? null : nextPrompt);
    if (isNextPromptMissing) continue;

    pendingPrompts.push(nextPrompt);
  }
  clearQueuedPrompt(details.state);
}

function clearQueuedPrompt(status: ComposerStatus) {
  status.refs.queuedPromptRef.current.length = 0;
  status.setQueuedPrompt(null);
}
