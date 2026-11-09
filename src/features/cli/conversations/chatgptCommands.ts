import type { ConversationSearchResult } from "@/features/conversations/conversationCatalogSchemas.ts";
import type {
  ArchiveChatOutcome,
  MoveChatOutcome,
} from "@/features/webProviders/chatgpt/chatgptWorkspace.ts";
import {
  archiveChat,
  createProject,
  deleteProject,
  listProjects,
  listTasks,
  moveChatToProject,
  renameProject,
} from "@/features/webProviders/chatgpt/chatgptWorkspace.ts";
import {
  type ChatGptRenderState,
  readAllChatGptTabRenderStates,
  readChatGptRenderState,
} from "@/features/webProviders/chatgpt/content/chatgptRenderState.ts";
import { requireChatgptProvider, startChatgptSession } from "../browser/browserConnection.ts";
import type {
  ChatCmdOptions,
  ChatgptCmdOptions,
  ProjectCmdOptions,
  TaskCmdOptions,
} from "../presentation/cliTypes.ts";
import { exitWithCliError } from "../presentation/commandOutput.ts";

export const runProjectList = async (options: ProjectCmdOptions): Promise<void> => {
  requireChatgptProvider(options);
  const { engine, page } = await startChatgptSession(options);
  const projects = await listProjects(page);
  await engine.shutdown({ closeBrowser: false });
  if (options.json) process.stdout.write(`${JSON.stringify(projects)}\n`);
  else if (projects.length === 0) process.stdout.write("No projects.\n");
  else for (const project of projects) process.stdout.write(`${project.name}\n`);
  process.exit(0);
};

export const runProjectCreate = async (name: string, options: ProjectCmdOptions): Promise<void> => {
  requireChatgptProvider(options);
  if (!name.trim()) exitWithCliError("Usage: bridge project create <name>");
  const { engine, page } = await startChatgptSession(options);
  const project = await createProject(page, name);
  await engine.shutdown({ closeBrowser: false });
  if (options.json) process.stdout.write(`${JSON.stringify(project)}\n`);
  else process.stdout.write(`Created project: ${project.name}\n`);
  process.exit(0);
};

export const runProjectRename = async (name: string, options: ProjectCmdOptions): Promise<void> => {
  requireChatgptProvider(options);
  const to = options.to?.trim();
  if (!name.trim() || !to)
    return exitWithCliError("Usage: bridge project rename <name> --to <newName>");
  const { engine, page } = await startChatgptSession(options);
  const outcome = await renameProject(page, { project: name, name: to });
  await engine.shutdown({ closeBrowser: false });
  if (options.json) process.stdout.write(`${JSON.stringify(outcome)}\n`);
  else if (outcome.renamed)
    process.stdout.write(`Renamed "${outcome.project}" -> ${outcome.renamedTo}\n`);
  else process.stdout.write(`Skipped "${outcome.project}": ${outcome.reason}\n`);
  process.exit(outcome.renamed ? 0 : 1);
};

export const runProjectDelete = async (name: string, options: ProjectCmdOptions): Promise<void> => {
  requireChatgptProvider(options);
  if (!name.trim()) return exitWithCliError("Usage: bridge project delete <name> --yes");
  if (!options.yes) {
    return exitWithCliError(
      `Refusing to delete project "${name}" without --yes; this permanently deletes its chats.`,
    );
  }
  const { engine, page } = await startChatgptSession(options);
  const outcome = await deleteProject(page, name);
  await engine.shutdown({ closeBrowser: false });
  if (options.json) process.stdout.write(`${JSON.stringify(outcome)}\n`);
  else if (outcome.deleted) process.stdout.write(`Deleted project "${outcome.project}"\n`);
  else process.stdout.write(`Skipped "${outcome.project}": ${outcome.reason}\n`);
  process.exit(outcome.deleted ? 0 : 1);
};

export const runChatList = async (options: ChatCmdOptions): Promise<void> => {
  requireChatgptProvider(options);
  const { engine } = await startChatgptSession(options);
  const chats = await engine
    .getBrowserConversation()
    .listConversations({ orphans: Boolean(options.orphans) });
  await engine.shutdown({ closeBrowser: false });
  let output = "";
  if (options.json) output = `${JSON.stringify(chats)}\n`;
  else if (chats.length === 0) output = "No conversations.\n";
  else output = `${chats.map((chat) => `${chat.id}\t${chat.title}`).join("\n")}\n`;
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(output, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  process.exit(0);
};

export const runChatSearch = async (query: string, options: ChatCmdOptions): Promise<void> => {
  requireChatgptProvider(options);
  if (!query.trim()) exitWithCliError("Usage: bridge chat search <query>");
  const { engine } = await startChatgptSession(options);
  let conversationMatches: ConversationSearchResult[];
  try {
    conversationMatches = await engine.getBrowserConversation().searchConversations({
      query,
      limit: limitFromOption(options.limit),
    });
  } catch (error) {
    await engine.shutdown({ closeBrowser: false });
    return exitWithCliError(error instanceof Error ? error.message : String(error));
  }
  await maybeOpenSearchMatch({ engine, results: conversationMatches, open: Boolean(options.open) });
  await engine.shutdown({ closeBrowser: false });
  writeChatSearchOutput(conversationMatches, options);
  process.exit(conversationMatches.length > 0 ? 0 : 1);
};

const limitFromOption = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const maybeOpenSearchMatch = async (input: {
  engine: Awaited<ReturnType<typeof startChatgptSession>>["engine"];
  results: ConversationSearchResult[];
  open: boolean;
}): Promise<void> => {
  const [best] = input.results;
  if (!input.open || !best) return;
  await input.engine.getBrowserConversation().navigateToConversation(best.url);
};

const writeChatSearchOutput = (
  conversationMatches: ConversationSearchResult[],
  options: ChatCmdOptions,
): void => {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(conversationMatches)}\n`);
    return;
  }
  if (conversationMatches.length === 0) {
    process.stdout.write("No matching conversations.\n");
    return;
  }
  for (const hit of conversationMatches) {
    process.stdout.write(`${hit.id}	${hit.title}	${hit.source}	${hit.score}
`);
  }
};

export const chatTargetsFrom = (chat: string, options: ChatCmdOptions): string[] => {
  const rawIds = options.id === undefined ? [] : options.id;
  const ids = rawIds.map((value) => value.trim()).filter(Boolean);
  if (ids.length > 0) return ids;
  const single = chat.trim();
  if (single) return [single];
  return [];
};

const writeMoveOutcomes = (outcomes: MoveChatOutcome[], options: ChatCmdOptions): void => {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(outcomes)}\n`);
    return;
  }
  for (const outcome of outcomes) {
    if (outcome.moved) process.stdout.write(`Moved "${outcome.chat}" -> ${outcome.project}\n`);
    else if (outcome.alreadyFiled) {
      process.stdout.write(`Already filed "${outcome.chat}" -> ${outcome.project}\n`);
    } else process.stdout.write(`Skipped "${outcome.chat}": ${outcome.reason}\n`);
  }
};

export const runChatMove = async (chat: string, options: ChatCmdOptions): Promise<void> => {
  requireChatgptProvider(options);
  const project = options.project?.trim();
  const targets = chatTargetsFrom(chat, options);
  if (targets.length === 0 || !project) {
    return exitWithCliError(
      "Usage: bridge chat move <idOrTitle> --project <name>  (multiple: --id <id...>)",
    );
  }
  const { engine, page } = await startChatgptSession(options);
  const outcomes: MoveChatOutcome[] = [];
  for (const target of targets) {
    outcomes.push(await moveChatToProject(page, { chat: target, project }));
  }
  await engine.shutdown({ closeBrowser: false });
  writeMoveOutcomes(outcomes, options);
  process.exit(outcomes.every((outcome) => outcome.moved || outcome.alreadyFiled) ? 0 : 1);
};

const writeArchiveOutcomes = (outcomes: ArchiveChatOutcome[], options: ChatCmdOptions): void => {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(outcomes)}\n`);
    return;
  }
  for (const outcome of outcomes) {
    if (outcome.archived) process.stdout.write(`Archived "${outcome.chat}"\n`);
    else process.stdout.write(`Skipped "${outcome.chat}": ${outcome.reason}\n`);
  }
};

export const runChatArchive = async (chat: string, options: ChatCmdOptions): Promise<void> => {
  requireChatgptProvider(options);
  const targets = chatTargetsFrom(chat, options);
  if (targets.length === 0) {
    return exitWithCliError("Usage: bridge chat archive <idOrTitle>  (multiple: --id <id...>)");
  }
  const { engine, page } = await startChatgptSession(options);
  const outcomes: ArchiveChatOutcome[] = [];
  for (const target of targets) {
    outcomes.push(await archiveChat(page, target));
  }
  await engine.shutdown({ closeBrowser: false });
  writeArchiveOutcomes(outcomes, options);
  process.exit(outcomes.every((outcome) => outcome.archived) ? 0 : 1);
};

export const runTaskList = async (options: TaskCmdOptions): Promise<void> => {
  requireChatgptProvider(options);
  const { engine, page } = await startChatgptSession(options);
  const tasks = await listTasks(page);
  await engine.shutdown({ closeBrowser: false });
  if (options.json) process.stdout.write(`${JSON.stringify(tasks)}\n`);
  else if (tasks.length === 0) process.stdout.write("No scheduled tasks.\n");
  else
    for (const task of tasks)
      process.stdout.write(`${task.title}${task.schedule ? `\t${task.schedule}` : ""}\n`);
  process.exit(0);
};

export const runTaskCreate = async (prompt: string, options: TaskCmdOptions): Promise<void> => {
  requireChatgptProvider(options);
  if (!prompt.trim())
    exitWithCliError("Usage: bridge task create <prompt> [--every <spec> | --at <spec>]");
  const { engine } = await startChatgptSession(options);
  const content = scheduledTaskPrompt(prompt, options);
  const reply = await engine.ask({ content });
  await engine.shutdown({ closeBrowser: false });
  if (options.json) {
    const replyContent = reply === undefined || reply === null ? null : reply.content;
    process.stdout.write(`${JSON.stringify({ content, reply: replyContent })}\n`);
  } else if (reply === undefined || reply === null) {
    process.stdout.write("(no reply captured)\n");
  } else {
    process.stdout.write(`${reply.content}\n`);
  }
  process.exit(0);
};

export const scheduledTaskPrompt = (prompt: string, options: TaskCmdOptions): string => {
  const cadence = scheduledTaskCadence(options);
  if (cadence === undefined) return `Set up a ChatGPT scheduled task: ${prompt.trim()}.`;
  return `Set up a ChatGPT scheduled task: ${prompt.trim()}. Schedule it to run ${cadence}.`;
};

const scheduledTaskCadence = (options: TaskCmdOptions): string | undefined => {
  if (options.every) return `every ${options.every}`;
  if (options.at) return `at ${options.at}`;
  return undefined;
};

const formatRenderStateLine = (state: ChatGptRenderState): string => {
  const parts = [
    state.streaming ? "streaming" : "idle",
    `images ${state.images.loaded}/${state.images.total}`,
  ];
  if (state.images.pending > 0) parts.push(`${state.images.pending} pending`);
  if (state.expectedImageMarkers > 0) parts.push(`${state.expectedImageMarkers} expected`);
  if (state.misfireSuspected) parts.push("misfire?");
  if (state.limitHit) {
    const limitNotice = state.limitNotice === undefined ? "hit" : state.limitNotice;
    parts.push(`limit: ${limitNotice}`);
  }
  return parts.join(" | ");
};

export const runChatgptInspect = async (options: ChatgptCmdOptions): Promise<void> => {
  const { engine, page } = await startChatgptSession(options);
  if (options.allTabs) {
    const tabs = await readAllChatGptTabRenderStates(page);
    await engine.shutdown({ closeBrowser: false });
    if (options.json) process.stdout.write(`${JSON.stringify(tabs)}\n`);
    else if (tabs.length === 0) process.stdout.write("No ChatGPT tabs open.\n");
    else
      for (const tab of tabs) process.stdout.write(`${formatRenderStateLine(tab)}\t${tab.url}\n`);
    process.exit(0);
  }
  const state = await readChatGptRenderState(page);
  await engine.shutdown({ closeBrowser: false });
  process.stdout.write(
    options.json ? `${JSON.stringify(state)}\n` : `${formatRenderStateLine(state)}\n`,
  );
  process.exit(0);
};
