import type { CommandContext } from "@/domain/command-types.ts";
import { projectTaskPromptWithInstructions } from "@/terminal/cli-operations.ts";
import { loadProjectInstructions } from "@/user-config/project-instructions.ts";
import { shouldAutoWrapProjectPrompt } from "./role-theme-config.ts";

export type ProjectAwarePromptOptions = {
  input: string;
  ctx: CommandContext;
};

/** Wraps input with project instructions when the prompt looks repo-related. */
export const projectAwarePrompt = async (options: ProjectAwarePromptOptions): Promise<string> => {
  const isNotAutoWrapProjectPrompt = !shouldAutoWrapProjectPrompt(options.input);
  if (isNotAutoWrapProjectPrompt) return options.input;

  const instructions = await loadProjectInstructions(options.ctx.config.repoPath);
  return projectTaskPromptWithInstructions(options.input, options.ctx, instructions.promptText);
};
