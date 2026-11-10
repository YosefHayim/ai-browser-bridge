import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import type { CommandSession } from "@/domain/command-types.ts";
import { readExportsDirectory, readSessionsDirectory } from "@/store/paths.ts";
import {
  exportSession,
  getLatestSession,
  listSessions,
  loadSession,
  type SessionExport,
  type SessionMetadata,
  type SessionStoreSettings,
} from "@/store/session-store.ts";
import { NEWLINE, SPACE } from "@/terminal/cli-text.ts";
import { splitArgumentList } from "@/terminal/split-argument-list.ts";
import { trimPrintout } from "@/tools/mcp-server.ts";

const NO_SESSION_SELECTED_MESSAGE = "No local session selected. Use /sessions first.";

const NO_SESSIONS_MESSAGE = "No local bridge sessions found.";

const readSessionStore = (repoPath: string): SessionStoreSettings => {
  return { baseDir: readSessionsDirectory(repoPath) };
};

type TryLoadSessionParameters = {
  sessionId: string;
  options: SessionStoreSettings;
};

const tryLoadSession = async (parameters: TryLoadSessionParameters) => {
  try {
    return await loadSession(parameters.sessionId, parameters.options);
  } catch {
    return null;
  }
};

type SessionIdDetails = {
  args: string;
  commandSession: CommandSession;
};

const readRequestedOrCurrentSessionId = async (
  parameters: SessionIdDetails,
): Promise<string | null> => {
  const [requested] = splitArgumentList(parameters.args);

  const isRequestedFound = requested != null && requested !== "";
  if (isRequestedFound) return requested;

  const sessionId = parameters.commandSession.session?.getId();

  const isSessionIdFound = sessionId != null && sessionId !== "";
  if (isSessionIdFound) return sessionId;

  const latest = await getLatestSession(
    readSessionStore(parameters.commandSession.config.repoPath),
  );

  const isLatestMissing = latest == null;
  if (isLatestMissing) return null;

  return latest.metadata.id;
};

const copyToClipboard = async (clipboardString: string): Promise<void> => {
  await new Promise<void>((...argumentList: [() => void, (reason?: unknown) => void]) => {
    runPbcopy({ text: clipboardString, resolve: argumentList[0], reject: argumentList[1] });
  });
};

const runPbcopy = (details: {
  text: string;
  resolve: () => void;
  reject: (reason?: unknown) => void;
}): void => {
  const child = execFile("pbcopy", (error) => {
    const isErrorFound = error != null;
    if (isErrorFound) details.reject(error);
    else details.resolve();
  });
  child.stdin?.end(details.text);
};

type SessionExportSelection = {
  sessionId: string | null;
  outputPath: string | null;
};

type SessionExportParameters = {
  args: string;
  commandSession: CommandSession;
};

const readSessionExportFromArgumentList = async (
  parameters: SessionExportParameters,
): Promise<SessionExportSelection> => {
  const parts = splitArgumentList(parameters.args);

  const isPartsEmpty = parts.length === 0;
  if (isPartsEmpty) {
    return {
      sessionId: await readRequestedOrCurrentSessionId({
        args: "",
        commandSession: parameters.commandSession,
      }),
    };
  }

  return readSessionExportFromParts({ parts, commandSession: parameters.commandSession });
};

const readSessionExportFromParts = async (details: {
  parts: string[];
  commandSession: CommandSession;
}): Promise<SessionExportSelection> => {
  const first = details.parts[0] ?? "";
  const store = readSessionStore(details.commandSession.config.repoPath);

  const session = await tryLoadSession({ sessionId: first, options: store });

  const hasSession = session != null;
  if (hasSession) {
    const exportPathArgument = details.parts[1];
    const isExportPathGiven = exportPathArgument != null && exportPathArgument !== "";

    return {
      sessionId: session.metadata.id,
      outputPath: isExportPathGiven ? resolve(exportPathArgument) : null,
    };
  }

  return {
    sessionId: await readRequestedOrCurrentSessionId({
      args: "",
      commandSession: details.commandSession,
    }),
    outputPath: resolve(first),
  };
};

const readDefaultExportPath = (parameters: { repoPath: string; sessionId: string }): string => {
  return join(readExportsDirectory(parameters.repoPath), `${parameters.sessionId}.md`);
};

const exportMessageForPath = (parameters: { path: string; exported: SessionExport }): string => {
  const extension = extname(parameters.path).toLowerCase();

  const isDocumentFile = extension === ".json";
  if (isDocumentFile) return parameters.exported.json;

  const isExtensionJsonl = extension === ".jsonl";
  if (isExtensionJsonl) return parameters.exported.jsonl;

  return parameters.exported.transcript;
};

export const listConversationsCommand = async (
  argumentList: string,
  commandSession: CommandSession,
): Promise<void> => {
  const hasArgumentList = argumentList.trim();
  if (hasArgumentList) {
    await openMatchingConversation({ query: argumentList.trim(), commandSession: commandSession });
    return;
  }

  const conversations = await commandSession.orchestrator.listConversations();

  const isConversationsEmpty = conversations.length === 0;
  if (isConversationsEmpty) {
    console.log("No conversations found in sidebar.");
    return;
  }

  printConversationList(conversations);
};

type OpenMatchingConversationParameters = {
  query: string;
  commandSession: CommandSession;
};

const openMatchingConversation = async (
  parameters: OpenMatchingConversationParameters,
): Promise<void> => {
  const [hit] = await parameters.commandSession.orchestrator.searchConversations({
    query: parameters.query,
    limit: 1,
  });

  const hasHit = hit != null;
  if (hasHit) {
    console.log(`Navigating to: ${hit.title} (${hit.id})`);
    await parameters.commandSession.orchestrator.navigateToConversation(hit.url);
    return;
  }

  console.log(`No conversation matching "${parameters.query}".`);
};

const printConversationList = (conversations: Array<{ id: string; title: string }>): void => {
  console.log("\nChatGPT Conversations:\n");
  conversations.forEach((conversation, i) => {
    const conversationNumberWidth = 2;

    console.log(`  ${String(i + 1).padStart(conversationNumberWidth)}. ${conversation.title}`);
  });
  console.log("\nUse /resume <number> to continue a conversation.\n");
};

export const listSessionsCommand = async (
  _argumentList: string,
  commandSession: CommandSession,
): Promise<void> => {
  const sessions = await listSessions(readSessionStore(commandSession.config.repoPath));

  const isSessionsEmpty = sessions.length === 0;
  if (isSessionsEmpty) {
    console.log(NO_SESSIONS_MESSAGE);
    return;
  }

  printSessions({ sessions, currentId: commandSession.session?.getId() });
};

type PrintSessionStoredParameters = {
  sessions: Array<{ id: string; updatedAt: string; model?: string | null; repoPath: string }>;
  currentId?: string;
};

const printSessions = (parameters: PrintSessionStoredParameters): void => {
  console.log("\nLocal sessions:\n");

  const sessionListLimit = 20;

  for (const session of parameters.sessions.slice(0, sessionListLimit)) {
    const isCurrentSession = session.id === parameters.currentId;
    const marker = isCurrentSession ? "*" : SPACE;
    const sessionIdColumnWidth = 38;

    console.log(
      `${marker} ${session.id.padEnd(sessionIdColumnWidth)} ${session.updatedAt} ${readSessionModelLabel(session.model)} ${session.repoPath}`,
    );
  }

  console.log("\nUse /resume --last or /resume <session-id> to make a session current.\n");
};

export const resumeSessionCommand = async (
  argumentList: string,
  commandSession: CommandSession,
): Promise<void> => {
  const query = argumentList.trim();

  const isQueryBlank = query == null || query === "";
  if (isQueryBlank) {
    console.log(
      "Usage: /resume <number|title|id> or /resume --last (use /conversations or /sessions)",
    );
    return;
  }

  const isQueryLast = query === "--last";
  if (isQueryLast) {
    await resumeLatestSession(commandSession);
    return;
  }

  const isSessionResumed = await resumeLocalSession({ query, commandSession: commandSession });
  if (isSessionResumed) return;

  await resumeBrowserConversation({ query, commandSession: commandSession });
};

const resumeLatestSession = async (commandSession: CommandSession): Promise<void> => {
  const latest = await getLatestSession(readSessionStore(commandSession.config.repoPath));

  const isLatestMissing = latest == null;
  if (isLatestMissing) {
    console.log(NO_SESSIONS_MESSAGE);
    return;
  }

  await commandSession.session?.setId(latest.metadata.id);
  console.log(createSessionSummary(latest.metadata, commandSession.session?.getId()));
};

type ResumeLocalSessionParameters = {
  query: string;
  commandSession: CommandSession;
};

const resumeLocalSession = async (parameters: ResumeLocalSessionParameters): Promise<boolean> => {
  const localSession = await tryLoadSession({
    sessionId: parameters.query,
    options: readSessionStore(parameters.commandSession.config.repoPath),
  });

  const isLocalSessionMissing = localSession == null;
  if (isLocalSessionMissing) return false;

  await parameters.commandSession.session?.setId(localSession.metadata.id);
  console.log(
    createSessionSummary(localSession.metadata, parameters.commandSession.session?.getId()),
  );
  return true;
};

type ResumeBrowserConversationParameters = {
  query: string;
  commandSession: CommandSession;
};

const resumeBrowserConversation = async (
  parameters: ResumeBrowserConversationParameters,
): Promise<void> => {
  const target = await findBrowserConversation({
    commandSession: parameters.commandSession,
    query: parameters.query,
  });

  const isTargetEmpty = !target;
  if (isTargetEmpty) {
    console.log(
      `No conversation matching "${parameters.query}". Use /conversations to see the list.`,
    );
    return;
  }

  console.log(`Resuming: ${target.title}`);
  await parameters.commandSession.orchestrator.navigateToConversation(target.url);
};

const findBrowserConversation = async (details: {
  commandSession: CommandSession;
  query: string;
}): Promise<{ id: string; title: string; url: string } | undefined> => {
  const decimalRadix = 10;

  const num = Number.parseInt(details.query, decimalRadix);

  const isNumNaN = Number.isNaN(num);
  if (isNumNaN) {
    const [hit] = await details.commandSession.orchestrator.searchConversations({
      query: details.query,
      limit: 1,
    });
    return hit;
  }

  const conversations = await details.commandSession.orchestrator.listConversations();
  return conversations[num - 1];
};

export const showTranscriptCommand = async (
  argumentList: string,
  commandSession: CommandSession,
): Promise<void> => {
  const sessionId = await readRequestedOrCurrentSessionId({
    args: argumentList,
    commandSession: commandSession,
  });

  const isSessionIdEmpty = !sessionId;
  if (isSessionIdEmpty) {
    console.log(NO_SESSION_SELECTED_MESSAGE);
    return;
  }

  const exported = await exportSession(sessionId, readSessionStore(commandSession.config.repoPath));
  const transcriptPrintLimitCharacters = 40_000;

  console.log(
    trimPrintout(exported.transcript || "(empty transcript)", transcriptPrintLimitCharacters),
  );
};

export const copyTranscriptCommand = async (
  argumentList: string,
  commandSession: CommandSession,
): Promise<void> => {
  const sessionId = await readRequestedOrCurrentSessionId({
    args: argumentList,
    commandSession: commandSession,
  });

  const isSessionIdEmpty = !sessionId;
  if (isSessionIdEmpty) {
    console.log(NO_SESSION_SELECTED_MESSAGE);
    return;
  }

  const exported = await exportSession(sessionId, readSessionStore(commandSession.config.repoPath));
  await copyToClipboard(exported.transcript);
  console.log(`Copied transcript for ${sessionId} to clipboard.`);
};

export const exportTranscriptCommand = async (
  argumentList: string,
  commandSession: CommandSession,
): Promise<void> => {
  const selection = await readSessionExportFromArgumentList({
    args: argumentList,
    commandSession: commandSession,
  });

  const selectedSessionId = selection.sessionId;

  const isSelectionSessionIdEmpty = selectedSessionId == null || selectedSessionId === "";
  if (isSelectionSessionIdEmpty) {
    console.log(NO_SESSION_SELECTED_MESSAGE);
    return;
  }

  await writeSessionExport({
    sessionId: selectedSessionId,
    outputPath: selection.outputPath,
    commandSession: commandSession,
  });
};

type WriteSessionExportParameters = {
  sessionId: string;
  outputPath: string | null;
  commandSession: CommandSession;
};

const writeSessionExport = async (parameters: WriteSessionExportParameters): Promise<void> => {
  const store = readSessionStore(parameters.commandSession.config.repoPath);
  const exported = await exportSession(parameters.sessionId, store);
  const targetPath =
    parameters.outputPath ??
    readDefaultExportPath({
      repoPath: parameters.commandSession.config.repoPath,
      sessionId: parameters.sessionId,
    });

  await persistSessionExport({ targetPath, exported, sessionId: parameters.sessionId });
};

const persistSessionExport = async (details: {
  targetPath: string;
  exported: Awaited<ReturnType<typeof exportSession>>;
  sessionId: string;
}): Promise<void> => {
  const message = exportMessageForPath({ path: details.targetPath, exported: details.exported });
  await mkdir(dirname(details.targetPath), { recursive: true });
  await writeFile(details.targetPath, message, "utf-8");
  console.log(`Exported ${details.sessionId} to ${details.targetPath}`);
};

export const createSessionSummary = (session: SessionMetadata, currentId?: string): string => {
  const isCurrentSession = session.id === currentId;
  const marker = isCurrentSession ? "current" : "loaded";

  return [
    `Local session ${marker}: ${session.id}`,
    `Repo: ${session.repoPath}`,
    `Model: ${readSessionModelLabel(session.model)}`,
    `Context: ${session.contextLimit.toLocaleString()} tokens`,
    `Updated: ${session.updatedAt}`,
    `Tunnel: ${readSessionTunnelLabel(session.tunnelUrl)}`,
  ].join(NEWLINE);
};

const readSessionModelLabel = (model: string | null | undefined): string => {
  const isModelBlank = model == null || model === "";
  if (isModelBlank) return "unknown";

  return model;
};

const readSessionTunnelLabel = (tunnelUrl: string | null | undefined): string => {
  const isTunnelUrlBlank = tunnelUrl == null || tunnelUrl === "";
  if (isTunnelUrlBlank) return "none";

  return tunnelUrl;
};
