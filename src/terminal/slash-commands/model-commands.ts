import type { CommandSession } from "@/domain/command-types.ts";
import { findModelProfile, listModelProfiles } from "@/domain/model-lookup.ts";
import { SPACE } from "@/terminal/cli-text.ts";

export const runModelCommand = async (
  argumentList: string,
  commandSession: CommandSession,
): Promise<void> => {
  const query = argumentList.trim();

  const isQueryFound = query !== "";
  if (isQueryFound) {
    await switchModel({ query, commandSession: commandSession });
    return;
  }

  await showCurrentModel(commandSession);
};

const switchModel = async (parameters: {
  query: string;
  commandSession: CommandSession;
}): Promise<void> => {
  const model = await parameters.commandSession.orchestrator.switchModel(parameters.query);

  parameters.commandSession.counter.setModel(model);

  const profile = findModelProfile(model);

  console.log(
    `Model switched to ${model}. Context estimate now uses ${profile.contextWindow.toLocaleString()} tokens.`,
  );
};

const showCurrentModel = async (commandSession: CommandSession): Promise<void> => {
  const current = await commandSession.orchestrator.detectModel();
  commandSession.counter.setModel(current);
  printModelProfile(current);
  await printAvailableModels(commandSession);
};

const printAvailableModels = async (commandSession: CommandSession): Promise<void> => {
  const available = await commandSession.orchestrator.listModels();

  const hasAvailable = available.length > 0;
  if (hasAvailable) {
    printBrowserModels(available);
    return;
  }

  printKnownProfiles();
};

const printModelProfile = (model: string): void => {
  const profile = findModelProfile(model);
  console.log(`\nCurrent model: ${model}`);
  console.log(`Context window: ${profile.contextWindow.toLocaleString()} tokens`);

  const maxOutputTokens = profile.maxOutputTokens;
  const isMaxOutputTokensFound = maxOutputTokens != null && maxOutputTokens !== 0;
  if (isMaxOutputTokensFound) {
    console.log(`Max output:     ${maxOutputTokens.toLocaleString()} tokens`);
  }

  console.log(`Source:         ${profile.sourceUrl}`);
};

const printBrowserModels = (models: Array<{ label: string; selected?: boolean }>): void => {
  console.log("\nBrowser models:");
  for (const model of models) {
    const isSelected = model.selected === true;
    console.log(`  ${isSelected ? "*" : SPACE} ${model.label}`);
  }
  console.log("\nUse /model <name> to switch.");
};

const printKnownProfiles = (): void => {
  console.log("\nKnown context profiles:");
  for (const model of listModelProfiles()) {
    const modelLabelColumnWidth = 24;

    console.log(
      `  ${model.label.padEnd(modelLabelColumnWidth)} ${model.contextWindow.toLocaleString()} ctx`,
    );
  }
};

export const showEstimateCommand = async (
  _argumentList: string,
  commandSession: CommandSession,
): Promise<void> => {
  console.log(
    `Context estimate for ${commandSession.counter.modelLabel}: ${commandSession.counter.summary}`,
  );
};
