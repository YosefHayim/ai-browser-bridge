import type { startEngine } from "@/bridge/bridge-engine.ts";
import { readConversationUrlFromOption } from "@/terminal/cli-option-readers.ts";
import type { AskSettings } from "@/terminal/cli-types.ts";

export const applyAskPreflight = async (details: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  options: AskSettings;
}): Promise<void> => {
  if (details.options.fresh)
    await Promise.allSettled([details.engine.getOrchestrator().openNewConversation()]);
  else if (details.options.conversation) {
    await Promise.allSettled([
      details.engine
        .getOrchestrator()
        .navigateToConversation(readConversationUrlFromOption(details.options.conversation)),
    ]);
  }

  const model = details.options.model;
  const isModelEmpty = model == null || model === "";
  if (isModelEmpty) return;

  try {
    await details.engine.getOrchestrator().switchModel(model);
  } catch (error) {
    const isErrorObject = error instanceof Error;
    const reason = isErrorObject ? error.message : String(error);
    throw new Error(`Could not switch to model "${details.options.model}": ${reason}`);
  }
};
