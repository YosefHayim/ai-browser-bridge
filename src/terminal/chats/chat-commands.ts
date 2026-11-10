import type { ConversationSearchReport } from "@/conversation-catalog/conversation-catalog-schemas.ts";
import { readProjectIdNamed } from "@/providers/chatgpt/chatgpt-project-lookup.ts";
import { readProjectIds } from "@/providers/chatgpt/chatgpt-projects-api.ts";
import {
  type ArchiveChatVerdict,
  archiveChat,
  type MoveChatVerdict,
  moveChatToProject,
  type RenamedChat,
  renameChat,
} from "@/providers/chatgpt/chatgpt-workspace.ts";
import { fail, failUsage, readCliFailureMessage } from "@/terminal/cli-failure.ts";
import { readLimitFromOption } from "@/terminal/cli-option-readers.ts";
import { NEWLINE } from "@/terminal/cli-text.ts";
import type { ChatCommandSettings } from "@/terminal/cli-types.ts";
import { assertChatgptWorkspace, startWorkspaceSession } from "@/terminal/engine-session.ts";

export const runChatList = async (settings: ChatCommandSettings): Promise<void> => {
  assertChatgptWorkspace(settings);
  const { engine } = await startWorkspaceSession(settings);
  const chats = await engine
    .getOrchestrator()
    .listConversations({ orphans: Boolean(settings.orphans) });
  await engine.shutDown({ closeBrowser: false });
  let printout = "";

  const isThereNoChat = chats.length === 0;

  const isMachineReadable = settings.json;
  if (isMachineReadable) printout = `${JSON.stringify(chats)}\n`;
  else if (isThereNoChat) printout = "No conversations.\n";
  else printout = `${chats.map((chat) => `${chat.id}\t${chat.title}`).join(NEWLINE)}\n`;

  await new Promise<void>((finish, reject) => {
    process.stdout.write(printout, (error) => {
      const isErrorFound = error != null;
      if (isErrorFound) reject(error);
      else finish();
    });
  });
};

export const runChatSearch = async (
  query: string,
  settings: ChatCommandSettings,
): Promise<void> => {
  assertChatgptWorkspace(settings);

  const isQueryBlank = !query.trim();
  if (isQueryBlank) failUsage("Usage: bridge chat search <query>");

  const { engine } = await startWorkspaceSession(settings);
  const searchLimit = readLimitFromOption(settings.limit);
  const hasSearchLimit = searchLimit != null;
  let reports: ConversationSearchReport[];
  try {
    reports = await engine.getOrchestrator().searchConversations({
      query,
      ...(hasSearchLimit ? { limit: searchLimit } : {}),
    });
  } catch (error) {
    await engine.shutDown({ closeBrowser: false });
    return fail(readCliFailureMessage(error));
  }
  await openSearchHitIfFound({ engine, results: reports, open: Boolean(settings.open) });
  await engine.shutDown({ closeBrowser: false });
  writeChatSearchPrintout(reports, settings);

  const isThereNoSearchHit = reports.length === 0;
  if (isThereNoSearchHit) throw new Error(`No conversation matches "${query}".`);
};

const openSearchHitIfFound = async (details: {
  engine: Awaited<ReturnType<typeof startWorkspaceSession>>["engine"];
  results: ConversationSearchReport[];
  open: boolean;
}): Promise<void> => {
  const [best] = details.results;

  const isOpenIncomplete = !details.open || !best;
  if (isOpenIncomplete) return;

  await details.engine.getOrchestrator().navigateToConversation(best.url);
};

const writeChatSearchPrintout = (
  reports: ConversationSearchReport[],
  settings: ChatCommandSettings,
): void => {
  const isMachineReadable = settings.json;
  if (isMachineReadable) {
    process.stdout.write(`${JSON.stringify(reports)}\n`);
    return;
  }

  const hasNoReports = reports.length === 0;
  if (hasNoReports) {
    process.stdout.write("No matching conversations.\n");
    return;
  }

  for (const hit of reports) {
    process.stdout.write(`${hit.id}	${hit.title}	${hit.source}	${hit.score}
`);
  }
};

export const listChatTargets = (chat: string, settings: ChatCommandSettings): string[] => {
  const isIdMissing = settings.id == null;
  const unparsedIds = isIdMissing ? [] : settings.id;
  const ids = unparsedIds.map((field) => field.trim()).filter(Boolean);

  const hasIds = ids.length > 0;
  if (hasIds) return ids;

  const single = chat.trim();

  const isSingleFound = single !== "";
  if (isSingleFound) return [single];

  return [];
};

const writeMoveReports = (moveReports: MoveChatVerdict[], settings: ChatCommandSettings): void => {
  const isMachineReadable = settings.json;
  if (isMachineReadable) {
    process.stdout.write(`${JSON.stringify(moveReports)}\n`);
    return;
  }

  for (const verdict of moveReports) {
    const isMoved = verdict.moved;
    const isAlreadyFiled = verdict.alreadyFiled;
    if (isMoved) process.stdout.write(`Moved "${verdict.chat}" -> ${verdict.project}\n`);
    else if (isAlreadyFiled) {
      process.stdout.write(`Already filed "${verdict.chat}" -> ${verdict.project}\n`);
    } else process.stdout.write(`Skipped "${verdict.chat}": ${verdict.reason}\n`);
  }
};

export const runChatMove = async (chat: string, settings: ChatCommandSettings): Promise<void> => {
  assertChatgptWorkspace(settings);
  const project = settings.project?.trim();

  const targets = listChatTargets(chat, settings);

  const isNothingToSync = targets.length === 0 || !project;
  if (isNothingToSync) {
    return failUsage(
      "Usage: bridge chat move <idOrTitle> --project <name>  (multiple: --id <id...>)",
    );
  }

  const { engine, page } = await startWorkspaceSession(settings);
  const moveReports: MoveChatVerdict[] = [];
  try {
    const projectIdByName = await readProjectIds(page, [project]);
    const projectId = readProjectIdNamed(projectIdByName, project);
    for (const target of targets) {
      moveReports.push(await moveChatToProject(page, { chat: target, project, projectId }));
    }
  } finally {
    await engine.shutDown({ closeBrowser: false });
  }
  writeMoveReports(moveReports, settings);

  const isAnyChatNotMoved = !moveReports.every(
    (moveReport) => moveReport.moved || moveReport.alreadyFiled,
  );
  if (isAnyChatNotMoved) throw new Error("Some conversations were not moved.");
};

const writeRenamedChat = (renamedChat: RenamedChat, settings: ChatCommandSettings): void => {
  const isMachineReadable = settings.json;
  if (isMachineReadable) {
    process.stdout.write(`${JSON.stringify(renamedChat)}\n`);
    return;
  }

  process.stdout.write(`Renamed ${renamedChat.id} -> "${renamedChat.title}"\n`);
};

export const runChatRename = async (chat: string, settings: ChatCommandSettings): Promise<void> => {
  assertChatgptWorkspace(settings);
  const [target, ...otherTargets] = listChatTargets(chat, settings);
  const title = settings.title?.trim() ?? "";

  const isNotUsageValid = target == null || otherTargets.length !== 0 || title === "";
  if (isNotUsageValid) {
    return failUsage('Usage: bridge chat rename <idOrTitle> --title "<new title>"  (or --id <id>)');
  }

  const { engine, page } = await startWorkspaceSession(settings);
  try {
    const renamedChat = await renameChat(page, { chat: target, title });
    writeRenamedChat(renamedChat, settings);
  } finally {
    await engine.shutDown({ closeBrowser: false });
  }
};

const writeArchiveReports = (
  archiveReports: ArchiveChatVerdict[],
  settings: ChatCommandSettings,
): void => {
  const isMachineReadable = settings.json;
  if (isMachineReadable) {
    process.stdout.write(`${JSON.stringify(archiveReports)}\n`);
    return;
  }

  for (const verdict of archiveReports) {
    const isArchived = verdict.archived;
    if (isArchived) process.stdout.write(`Archived "${verdict.chat}"\n`);
    else process.stdout.write(`Skipped "${verdict.chat}": ${verdict.reason}\n`);
  }
};

export const runChatArchive = async (
  chat: string,
  settings: ChatCommandSettings,
): Promise<void> => {
  assertChatgptWorkspace(settings);
  const targets = listChatTargets(chat, settings);

  const isTargetsEmpty = targets.length === 0;
  if (isTargetsEmpty) {
    return failUsage("Usage: bridge chat archive <idOrTitle>  (multiple: --id <id...>)");
  }

  const { engine, page } = await startWorkspaceSession(settings);
  const archiveReports: ArchiveChatVerdict[] = [];
  for (const target of targets) {
    archiveReports.push(await archiveChat(page, target));
  }
  await engine.shutDown({ closeBrowser: false });
  writeArchiveReports(archiveReports, settings);

  const isAnyChatNotArchived = !archiveReports.every((archiveReport) => archiveReport.archived);
  if (isAnyChatNotArchived) throw new Error("Some conversations were not archived.");
};
