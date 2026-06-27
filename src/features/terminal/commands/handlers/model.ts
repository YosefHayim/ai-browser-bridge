import type { CommandContext } from "../../../domain/types.ts";
import { findModelProfile, listModelProfiles } from "../../../domain/models.config.ts";

/** Show or switch the ChatGPT model. */
export async function handleModel(args: string, ctx: CommandContext): Promise<void> {
  const query = args.trim();
  if (query) {
    await switchModel({ query, ctx });
    return;
  }
  await showCurrentModel(ctx);
}

/** Switch model and print context estimate update. */
async function switchModel(params: { query: string; ctx: CommandContext }): Promise<void> {
  const model = await params.ctx.orchestrator.switchModel(params.query);
  params.ctx.counter.setModel(model);
  const profile = findModelProfile(model);
  console.log(
    `Model switched to ${model}. Context estimate now uses ${profile.contextWindow.toLocaleString()} tokens.`,
  );
}

/** Print current model details and available browser models. */
async function showCurrentModel(ctx: CommandContext): Promise<void> {
  const current = await ctx.orchestrator.detectModel();
  ctx.counter.setModel(current);
  printModelProfile(current);
  await printAvailableModels(ctx);
}

/** Print browser models or static known profiles. */
async function printAvailableModels(ctx: CommandContext): Promise<void> {
  const available = await ctx.orchestrator.listModels();
  if (available.length > 0) {
    printBrowserModels(available);
    return;
  }
  printKnownProfiles();
}

/** Print context profile for a model name. */
function printModelProfile(model: string): void {
  const profile = findModelProfile(model);
  console.log(`\nCurrent model: ${model}`);
  console.log(`Context window: ${profile.contextWindow.toLocaleString()} tokens`);
  if (profile.maxOutputTokens) {
    console.log(`Max output:     ${profile.maxOutputTokens.toLocaleString()} tokens`);
  }
  console.log(`Source:         ${profile.sourceUrl}`);
}

/** Print browser model picker entries. */
function printBrowserModels(
  models: Array<{ label: string; selected?: boolean }>,
): void {
  console.log("\nBrowser models:");
  for (const model of models) {
    console.log(`  ${model.selected ? "*" : " "} ${model.label}`);
  }
  console.log("\nUse /model <name> to switch.");
}

/** Print static known context profiles. */
function printKnownProfiles(): void {
  console.log("\nKnown context profiles:");
  for (const model of listModelProfiles()) {
    console.log(`  ${model.label.padEnd(24)} ${model.contextWindow.toLocaleString()} ctx`);
  }
}

/** Show context window usage for the active model. */
export async function handleContext(_args: string, ctx: CommandContext): Promise<void> {
  console.log(`Context estimate for ${ctx.counter.modelLabel}: ${ctx.counter.summary}`);
}

/** Model-related slash-command handlers keyed by command name. */
export const MODEL_HANDLERS: Record<
  string,
  (args: string, ctx: CommandContext) => Promise<void>
> = {
  model: handleModel,
  context: handleContext,
};
