import { listTasks } from "@/providers/chatgpt/chatgpt-workspace.ts";
import { failUsage } from "./cli-failure.ts";
import type { TaskCommandSettings } from "./cli-types.ts";
import { assertChatgptWorkspace, startWorkspaceSession } from "./engine-session.ts";

export const runTaskList = async (settings: TaskCommandSettings): Promise<void> => {
  assertChatgptWorkspace(settings);
  const { engine, page } = await startWorkspaceSession(settings);
  const tasks = await listTasks(page);
  await engine.shutDown({ closeBrowser: false });

  const isThereNoTask = tasks.length === 0;

  const isMachineReadable = settings.json;
  if (isMachineReadable) process.stdout.write(`${JSON.stringify(tasks)}\n`);
  else if (isThereNoTask) process.stdout.write("No scheduled tasks.\n");
  else {
    for (const task of tasks) {
      const isScheduleFound = task.schedule != null && task.schedule !== "";
      const scheduleLabel = isScheduleFound ? `\t${task.schedule}` : "";
      process.stdout.write(`${task.title}${scheduleLabel}\n`);
    }
  }
};

export const runTaskCreate = async (
  prompt: string,
  settings: TaskCommandSettings,
): Promise<void> => {
  assertChatgptWorkspace(settings);

  const isPromptBlank = !prompt.trim();
  if (isPromptBlank) failUsage("Usage: bridge task create <prompt> [--every <spec> | --at <spec>]");

  const { engine } = await startWorkspaceSession(settings);
  const scheduledPrompt = readScheduledTaskPrompt(prompt, settings);
  const reply = await engine.ask({ content: scheduledPrompt });
  await engine.shutDown({ closeBrowser: false });

  const isReplyMissing = reply == null;

  const isMachineReadable = settings.json;
  if (isMachineReadable) {
    const replyMessage = isReplyMissing ? null : reply.content;
    process.stdout.write(`${JSON.stringify({ content: scheduledPrompt, reply: replyMessage })}\n`);
  } else if (isReplyMissing) {
    process.stdout.write("(no reply captured)\n");
  } else {
    process.stdout.write(`${reply.content}\n`);
  }
};

export const readScheduledTaskPrompt = (prompt: string, settings: TaskCommandSettings): string => {
  const cadence = readScheduledTaskCadence(settings);

  const isCadenceMissing = cadence == null;
  if (isCadenceMissing) return `Set up a ChatGPT scheduled task: ${prompt.trim()}.`;

  return `Set up a ChatGPT scheduled task: ${prompt.trim()}. Schedule it to run ${cadence}.`;
};

const readScheduledTaskCadence = (settings: TaskCommandSettings): string | null => {
  const isEveryFound = settings.every != null && settings.every !== "";
  if (isEveryFound) return `every ${settings.every}`;

  const isAtFound = settings.at != null && settings.at !== "";
  if (isAtFound) return `at ${settings.at}`;

  return null;
};
