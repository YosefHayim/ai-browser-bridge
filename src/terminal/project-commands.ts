import {
  createProject,
  deleteProject,
  listProjects,
  renameProject,
} from "@/providers/chatgpt/chatgpt-workspace.ts";
import { failUsage } from "./cli-failure.ts";
import type { ProjectCommandSettings } from "./cli-types.ts";
import { assertChatgptWorkspace, startWorkspaceSession } from "./engine-session.ts";

export const runProjectList = async (settings: ProjectCommandSettings): Promise<void> => {
  assertChatgptWorkspace(settings);
  const { engine, page } = await startWorkspaceSession(settings);
  const projects = await listProjects(page);
  await engine.shutDown({ closeBrowser: false });

  const isThereNoProject = projects.length === 0;

  if (settings.json) process.stdout.write(`${JSON.stringify(projects)}\n`);
  else if (isThereNoProject) process.stdout.write("No projects.\n");
  else for (const project of projects) process.stdout.write(`${project.name}\n`);
};

export const runProjectCreate = async (
  name: string,
  settings: ProjectCommandSettings,
): Promise<void> => {
  assertChatgptWorkspace(settings);

  const isNameBlank = !name.trim();
  if (isNameBlank) failUsage("Usage: bridge project create <name>");

  const { engine, page } = await startWorkspaceSession(settings);
  const project = await createProject(page, name);
  await engine.shutDown({ closeBrowser: false });

  if (settings.json) process.stdout.write(`${JSON.stringify(project)}\n`);
  else process.stdout.write(`Created project: ${project.name}\n`);
};

export const runProjectRename = async (
  name: string,
  settings: ProjectCommandSettings,
): Promise<void> => {
  assertChatgptWorkspace(settings);

  const to = settings.to?.trim();

  const isRenameIncomplete = !name.trim() || !to;
  if (isRenameIncomplete) return failUsage("Usage: bridge project rename <name> --to <newName>");

  const { engine, page } = await startWorkspaceSession(settings);
  const verdict = await renameProject(page, { project: name, name: to });
  await engine.shutDown({ closeBrowser: false });

  if (settings.json) process.stdout.write(`${JSON.stringify(verdict)}\n`);
  else if (verdict.renamed)
    process.stdout.write(`Renamed "${verdict.project}" -> ${verdict.renamedTo}\n`);
  else process.stdout.write(`Skipped "${verdict.project}": ${verdict.reason}\n`);

  const isRenameSkipped = !verdict.renamed;
  if (isRenameSkipped) throw new Error(`Project "${verdict.project}" was not renamed.`);
};

export const runProjectDelete = async (
  name: string,
  settings: ProjectCommandSettings,
): Promise<void> => {
  assertChatgptWorkspace(settings);

  const isNameBlank = !name.trim();
  if (isNameBlank) return failUsage("Usage: bridge project delete <name> --yes");

  const isYesNotGiven = !settings.yes;
  if (isYesNotGiven) {
    return failUsage(
      `Refusing to delete project "${name}" without --yes; this permanently deletes its chats.`,
    );
  }

  const { engine, page } = await startWorkspaceSession(settings);
  const verdict = await deleteProject(page, name);
  await engine.shutDown({ closeBrowser: false });

  if (settings.json) process.stdout.write(`${JSON.stringify(verdict)}\n`);
  else if (verdict.deleted) process.stdout.write(`Deleted project "${verdict.project}"\n`);
  else process.stdout.write(`Skipped "${verdict.project}": ${verdict.reason}\n`);

  const isDeleteSkipped = !verdict.deleted;
  if (isDeleteSkipped) throw new Error(`Project "${verdict.project}" was not deleted.`);
};
