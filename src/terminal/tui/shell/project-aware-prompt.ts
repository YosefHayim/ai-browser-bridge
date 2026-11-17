import type { CommandSession } from "@/command-types.ts";
import { loadProjectInstructions } from "@/repo-files/project-instructions.ts";
import { createProjectTaskPromptWithInstructions } from "@/terminal/cli/project-task-prompt.ts";
import { canAutoWrapProjectPrompt } from "@/terminal/tui/shell/role-theme-config.ts";

export type ProjectAwarePromptSettings = {
  input: string;
  commandSession: CommandSession;
};

export async function createProjectAwarePrompt(
  settings: ProjectAwarePromptSettings,
): Promise<string> {
  const isAutoWrapSkipped = !canAutoWrapProjectPrompt(settings.input);
  if (isAutoWrapSkipped) return settings.input;

  const instructions = await loadProjectInstructions(settings.commandSession.config.repoPath);
  return createProjectTaskPromptWithInstructions(
    settings.input,
    settings.commandSession,
    instructions.promptText,
  );
}
