import type { CommandContext } from "@/features/domain";
import { loadProjectInstructions } from "@/features/userConfig";
import { projectTaskPromptWithInstructions } from "../../cliOperations.ts";
import { shouldAutoWrapProjectPrompt } from "./roleThemeConfig.ts";

export type ProjectAwarePromptOptions = {
  input: string;
  ctx: CommandContext;
};

/** Wraps input with project instructions when the prompt looks repo-related. */
export const projectAwarePrompt = async (options: ProjectAwarePromptOptions): Promise<string> => {
  if (!shouldAutoWrapProjectPrompt(options.input)) return options.input;
  const instructions = await loadProjectInstructions(options.ctx.config.repoPath);
  return projectTaskPromptWithInstructions(options.input, options.ctx, instructions.promptText);
};
