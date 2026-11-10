import type { CommandSession } from "@/domain/command-types.ts";
import { findModelProfile, listModelProfiles } from "@/domain/model-lookup.ts";
import { SPACE } from "@/terminal/cli-text.ts";

export const runModelCommand = async (
  argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  const query = argumentList.trim();
  if (query) {
    await switchModel({ query, ctx: commandScope });
    return;
  }

  await showCurrentModel(commandScope);
};

const switchModel = async (parameters: { query: string; ctx: CommandSession }): Promise<void> => {
  const model = await parameters.ctx.orchestrator.switchModel(parameters.query);

  parameters.ctx.counter.setModel(model);

  const profile = findModelProfile(model);

  console.log(
    `Model switched to ${model}. Context estimate now uses ${profile.contextWindow.toLocaleString()} tokens.`,
  );
};

const showCurrentModel = async (commandScope: CommandSession): Promise<void> => {
  const current = await commandScope.orchestrator.detectModel();
  commandScope.counter.setModel(current);
  printModelProfile(current);
  await printAvailableModels(commandScope);
};

const printAvailableModels = async (commandScope: CommandSession): Promise<void> => {
  const available = await commandScope.orchestrator.listModels();

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

  if (profile.maxOutputTokens) {
    console.log(`Max output:     ${profile.maxOutputTokens.toLocaleString()} tokens`);
  }

  console.log(`Source:         ${profile.sourceUrl}`);
};

const printBrowserModels = (models: Array<{ label: string; selected?: boolean }>): void => {
  console.log("\nBrowser models:");
  for (const model of models) {
    console.log(`  ${model.selected ? "*" : SPACE} ${model.label}`);
  }
  console.log("\nUse /model <name> to switch.");
};

const printKnownProfiles = (): void => {
  console.log("\nKnown context profiles:");
  for (const model of listModelProfiles()) {
    console.log(`  ${model.label.padEnd(24)} ${model.contextWindow.toLocaleString()} ctx`);
  }
};

export const showEstimateCommand = async (
  _argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  console.log(
    `Context estimate for ${commandScope.counter.modelLabel}: ${commandScope.counter.summary}`,
  );
};
