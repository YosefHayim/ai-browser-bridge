import type { CommandContext } from "@/features/domain";
import { loadProjectInstructions } from "@/features/userConfig";
import { projectTaskPromptWithInstructions } from "../../cliOperations.ts";
import { shouldAutoWrapProjectPrompt } from "./roleThemeConfig.ts";

/** Options for building a project-aware prompt. */
export type ProjectAwarePromptOptions = {
  input: string;
  ctx: CommandContext;
};

/** Wraps input with project instructions when the prompt looks repo-related. */
export const projectAwarePrompt = async (options: ProjectAwarePromptOptions): Promise<string> => {
  const { input, ctx } = options;
  if (!shouldAutoWrapProjectPrompt(input)) return input;
  const instructions = await loadProjectInstructions(ctx.config.repoPath);
  return projectTaskPromptWithInstructions(input, ctx, instructions.promptText);
};
