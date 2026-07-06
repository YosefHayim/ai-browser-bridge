import type { CommandContext } from "@/features/domain";
import { loadProjectInstructions } from "@/features/userConfig";
import { buildProjectTaskPromptWithInstructions } from "../internal/cliRunner.ts";
import { shouldAutoWrapProjectPrompt } from "./roleThemeConfig.ts";

/** Options for building a project-aware prompt. */
export type ProjectAwarePromptOptions = {
  /** Raw user input. */
  input: string;
  /** Command execution context. */
  ctx: CommandContext;
};

/**
 * Wraps input with project instructions when the prompt looks repo-related.
 *
 * @param options - Options that configure the operation.
 * @returns The `projectAwarePrompt` result.
 * @example
 * ```ts
 * const result = await projectAwarePrompt(options);
 * ```
 */
export const projectAwarePrompt = async (options: ProjectAwarePromptOptions): Promise<string> => {
  const { input, ctx } = options;
  if (!shouldAutoWrapProjectPrompt(input)) return input;
  const instructions = await loadProjectInstructions(ctx.config.repoPath);
  return buildProjectTaskPromptWithInstructions(input, ctx, instructions.promptText);
};
