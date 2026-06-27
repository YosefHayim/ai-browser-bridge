import type { CommandContext } from "../../domain/types.ts";
import { buildProjectTaskPromptWithInstructions } from "../commands/prompts.ts";
import { loadProjectInstructions } from "../../user-config/project-instructions.ts";
import { shouldAutoWrapProjectPrompt } from "./role-theme.config.ts";

/** Options for building a project-aware prompt. */
export type ProjectAwarePromptOptions = {
  /** Raw user input. */
  input: string;
  /** Command execution context. */
  ctx: CommandContext;
};

/** Wraps input with project instructions when the prompt looks repo-related. */
export async function projectAwarePrompt(options: ProjectAwarePromptOptions): Promise<string> {
  const { input, ctx } = options;
  if (!shouldAutoWrapProjectPrompt(input)) return input;
  const instructions = await loadProjectInstructions(ctx.config.repoPath);
  return buildProjectTaskPromptWithInstructions(input, ctx, instructions.promptText);
}
