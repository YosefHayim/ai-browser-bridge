import type { CommandSession } from "@/domain/command-types.ts";
import { createProjectTaskPromptWithInstructions } from "@/terminal/project-task-prompt.ts";
import { canAutoWrapProjectPrompt } from "@/terminal/tui/shell/role-theme-config.ts";
import { loadProjectInstructions } from "@/user-config/project-instructions.ts";

export type ProjectAwarePromptSettings = {
  input: string;
  commandSession: CommandSession;
};

export const createProjectAwarePrompt = async (
  settings: ProjectAwarePromptSettings,
): Promise<string> => {
  const isAutoWrapSkipped = !canAutoWrapProjectPrompt(settings.input);
  if (isAutoWrapSkipped) return settings.input;

  const instructions = await loadProjectInstructions(settings.commandSession.config.repoPath);
  return createProjectTaskPromptWithInstructions(
    settings.input,
    settings.commandSession,
    instructions.promptText,
  );
};
