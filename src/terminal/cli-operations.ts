import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { render } from "ink";
import type { Page } from "playwright";
import React from "react";
import type { AskGatewayCollaborators } from "@/agent-gateway/ask-gateway-server.ts";
import { serveAskGatewayStdio } from "@/agent-gateway/serve-ask-gateway.ts";
import { type BridgeEngine, startEngine } from "@/bridge/bridge-engine.ts";
import { type FanoutTask, FanoutTasksSchema } from "@/bridge/bridge-schemas.ts";
import { fanOutConversations } from "@/bridge/fanout.ts";
import { type FanoutReport, type FanoutSettings, fanoutFailed } from "@/bridge/fanout-pool.ts";
import {
  readBridgeChromeProfileRoot,
  readConfiguredBrowserChoice,
} from "@/browser/browser-profile.ts";
import type { BrowserStatus, CacheInventory, PruneCacheReport } from "@/browser/browser-schemas.ts";
import {
  BRIDGE_DEBUG_PORT,
  BrowserSession,
  terminateChromeOnDebugPort,
} from "@/browser/browser-session.ts";
import { readBrowserStatus } from "@/browser/browser-state.ts";
import { measureChromeCache, pruneChromeCache } from "@/browser/chrome-cache.ts";
import { type BridgeProviderId, DEFAULT_PROVIDER } from "@/config";
import type { ConversationSearchReport } from "@/conversation-catalog/conversation-catalog-schemas.ts";
import type { Attachment } from "@/domain/attachment-types.ts";
import type { CommandDef, CommandSession } from "@/domain/command-types.ts";
import type { ConnectorSetupReport } from "@/domain/connector-types.ts";
import type { Message } from "@/domain/message-types.ts";
import { findModelProfile, listModelProfiles } from "@/domain/model-lookup.ts";
import { cleanPermissionMode, PERMISSION_MODES } from "@/domain/permissions.ts";
import { dismissChatGptHistoryRateLimit } from "@/providers/chatgpt/chatgpt-conversation-search.ts";
import {
  isSameChatGptConversation,
  readChatGptConversationIdFromUrl,
  readChatGptConversationUrlFromIdOrUrl,
} from "@/providers/chatgpt/chatgpt-conversation-url.ts";
import {
  downloadAll,
  downloadAttachment,
  extractAllMessages,
  loadManifest,
  registerConversationImages,
} from "@/providers/chatgpt/chatgpt-page.ts";
import { readProjectIdNamed } from "@/providers/chatgpt/chatgpt-project-lookup.ts";
import { readProjectIds } from "@/providers/chatgpt/chatgpt-projects-api.ts";
import {
  type ChatGptRenderStatus,
  readAllChatGptTabRenderStatuses,
  readChatGptRenderStatus,
} from "@/providers/chatgpt/chatgpt-render-state.ts";
import {
  type ArchiveChatVerdict,
  archiveChat,
  createProject,
  deleteProject,
  listProjects,
  listTasks,
  type MoveChatVerdict,
  moveChatToProject,
  type RenamedChat,
  renameChat,
  renameProject,
} from "@/providers/chatgpt/chatgpt-workspace.ts";
import {
  addClipToPrompt,
  addClipToScene,
  clearIngredients,
  deleteClip,
  deleteFlowProject,
  downloadClip,
  listClips,
  listFlowProjects,
  listIngredients,
  removeIngredient,
  renameClip,
  renameFlowProject,
} from "@/providers/flow/flow-assets.ts";
import { generateClipFromFrame } from "@/providers/flow/flow-generate.ts";
import {
  listProviderIdsFrom,
  readConversationIdForProviderUrl,
  readProvider,
  readProviderIdForUrl,
  readProviderIdFrom,
} from "@/providers/providers.ts";
import { listCheckpoints, restoreCheckpoint } from "@/store/checkpoints.ts";
import { readBridgeLogPath } from "@/store/logging.ts";
import {
  readAttachmentManifestsDirectory,
  readDownloadsDirectory,
  readExportsDirectory,
  readRepositoryPath,
  readRepositoryRoot,
  readScreenshotsDirectory,
  readSessionsDirectory,
} from "@/store/paths.ts";
import {
  exportSession,
  getLatestSession,
  listSessions,
  loadSession,
  type SessionExport,
  type SessionMetadata,
  type SessionStoreSettings,
} from "@/store/session-store.ts";
import { toolRegistry, trimPrintout } from "@/tools/mcp-server.ts";
import { loadCustomCommands, writeCustomCommandPrompt } from "@/user-config/custom-commands.ts";
import { loadProjectInstructions } from "@/user-config/project-instructions.ts";
import {
  acquireChatOrganizationQueueLock,
  type ChatOrganizationInterval,
  type ChatOrganizationPacing,
  type ChatOrganizationQueue,
  clampChatOrganizationPacing,
  clearChatOrganizationQueuePause,
  completeChatOrganizationQueueElement,
  createInitialChatOrganizationPacing,
  deferChatOrganizationQueueElement,
  failChatOrganizationQueueElement,
  findChatOrganizationQueue,
  findNextChatOrganizationQueueIndex,
  isChatOrganizationQueuePaused,
  isChatOrganizationSessionClosed,
  loadChatOrganizationTasks,
  openChatOrganizationQueue,
  pauseChatOrganizationQueue,
  persistChatOrganizationQueue,
  pickNextAdaptiveChatOrganizationIntervalSeconds,
  pickNextChatOrganizationIntervalSeconds,
  readChatOrganizationInterval,
  readChatOrganizationIntervalLabel,
  readChatOrganizationQueuePath,
  reopenChatOrganizationQueueElements,
  slowDownPacingAfterRateLimit,
  speedUpPacingAfterSuccess,
  summarizeChatOrganizationQueue,
  updateChatOrganizationQueuePacing,
  updateChatOrganizationQueueVerification,
  verifyChatOrganizationQueue,
} from "./chat-organization-queue.ts";
import { createUsageError } from "./cli-failure.ts";
import type {
  AskSettings,
  BrowserStatusSettings,
  BrowserTargetSettings,
  CacheCommandSettings,
  ChatCommandSettings,
  ChatgptCommandSettings,
  ChatOrganizationSettings,
  ChromeStartSettings,
  CliSettings,
  DownloadCommandSettings,
  DownloadReport,
  FlowCommandSettings,
  ProjectCommandSettings,
  ServeSettings,
  TaskCommandSettings,
} from "./cli-types.ts";
import { readProviderDisplayName } from "./provider-label.ts";
import { BridgeApp } from "./tui/shell/app.tsx";
import { addStopOnInterrupt } from "./user-interrupt.ts";

const PENDING_STATUS = "pending";
const MOVED_STATUS = "moved";
const FAILED_STATUS = "failed";
const CHATGPT_PROVIDER_ID = "chatgpt";
const ALREADY_FILED_STATUS = "already-filed";
const SAFE_CACHE_TARGETS_HEADING = "Safe generated-cache targets:";
const QUEUE_PAUSED_MESSAGE = "Organization queue paused.";
const NO_SESSION_SELECTED_MESSAGE = "No local session selected. Use /sessions first.";
const NO_SESSIONS_MESSAGE = "No local bridge sessions found.";
const MCP_DIAGNOSTICS_HEADING = "MCP bridge diagnostics:";
const PORT_FLAG = "--port";
const FILES_FLAG = "--files";
const DEBUG_PORT_FLAG = "--debug-port";
const LIST_SEPARATOR = ", ";
const SPACE = " ";
const CUSTOM_COMMANDS_HEADING = "\nCustom commands:\n";
const NEWLINE = "\n";

type CommandMeta = {
  name: string;
  description: string;
  aliases?: string[];
};

export const createProjectTaskPrompt = (task: string, commandScope: CommandSession): string => {
  return createProjectTaskPromptWithInstructions(task, commandScope, "");
};

export const createProjectTaskPromptWithInstructions = (
  task: string,
  commandScope: CommandSession,
  projectInstructions: string,
): string => {
  const hasProjectInstructions = projectInstructions.trim();

  return [
    "You are helping me modify this local project through the registered MCP connector.",
    "",
    "Project context:",
    `- Repo path: ${commandScope.config.repoPath}`,
    "- The terminal bridge exposes narrow local tools; use them instead of guessing from memory.",
    "",
    "Available MCP tools:",
    "- grep_code: search source code and find relevant files.",
    "- read_file: inspect exact file contents before proposing or editing.",
    "- apply_patch: make minimal code edits through sandbox-validated patches.",
    "- run_tests: run only allowlisted verification commands.",
    "- git_diff: review the current local diff before reporting completion.",
    "",
    "Required workflow:",
    "1. First action: call an MCP tool such as grep_code or read_file to prove the connector is active.",
    "2. Inspect the repository structure with grep_code/read_file and identify the relevant modules.",
    "3. Use grep_code to find the files, commands, tests, selectors, and patterns involved.",
    "4. Use read_file on the important files before making claims or edits.",
    "5. Briefly explain the structure you found and the files that matter.",
    "6. Make the smallest correct change, following existing patterns and avoiding unrelated refactors.",
    "7. If behavior changes, add or update focused tests when practical.",
    "8. Run the smallest useful verification first, then broader tests/build when relevant.",
    "9. Use git_diff to review the final diff.",
    "10. Report changed files, verification commands, and remaining risks.",
    "",
    "Rules:",
    "- Do not answer from guessing when the MCP tools can inspect the repo.",
    "- Do not ask me to paste tree/find output for this repo; use the MCP connector tools instead.",
    "- If you see only a hosted sandbox such as /mnt/data, or you ask for a zip/tree/find output, the connector is not active.",
    "- Do not use raw shell access or ask for broad local access.",
    "- Do not commit unless I explicitly ask.",
    "- If the MCP connector tools are unavailable in this chat, say: MCP connector is not active in this chat.",
    "- If a needed operation is not available through the tools, say exactly what is missing.",
    ...(hasProjectInstructions
      ? ["", "Project instruction files:", projectInstructions.trim()]
      : []),
    "",
    "User task:",
    task.trim(),
  ].join(NEWLINE);
};

export const readMcpConnectorUrl = (tunnelUrl?: string): string | null => {
  const isTunnelUrlBlank = tunnelUrl == null || tunnelUrl === "";
  if (isTunnelUrlBlank) return null;

  const normalized = tunnelUrl.replace(/\/+$/, "");
  const isMcpEndpointUrl = normalized.endsWith("/mcp") || normalized.endsWith("/sse");
  return isMcpEndpointUrl ? normalized : `${normalized}/mcp`;
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

const createBridgeStatus = (commandScope: CommandSession): string => {
  const provider = readProviderIdFrom(commandScope.config.provider);

  return [
    `Provider: ${provider}`,
    `Repo: ${commandScope.config.repoPath}`,
    `Branch: ${readStatusBranchLabel(commandScope)}`,
    `Session: ${readStatusSessionLabel(commandScope)}`,
    `Model: ${commandScope.counter.modelLabel}`,
    `Context: ${commandScope.counter.summary}`,
    `Permission: ${readStatusPermissionLabel(commandScope)}`,
    `Tool calls: ${readStatusToolCallCount(commandScope)}`,
    `Tunnel: ${readStatusTunnelLabel(commandScope)}`,
    `Connector: ${readStatusConnectorLabel(commandScope)}`,
  ].join(NEWLINE);
};

const readStatusBranchLabel = (commandScope: CommandSession): string => {
  const branch = commandScope.statusline?.branch;

  const isBranchBlank = branch == null || branch === "";
  if (isBranchBlank) return "unknown";

  return branch;
};

const readStatusSessionLabel = (commandScope: CommandSession): string => {
  const sessionId = commandScope.session?.getId();

  const isSessionIdBlank = sessionId == null || sessionId === "";
  if (isSessionIdBlank) return "none";

  return sessionId;
};

const readStatusPermissionLabel = (commandScope: CommandSession): string => {
  const liveMode = commandScope.permission?.getMode();

  const hasLiveMode = liveMode != null;
  if (hasLiveMode) return liveMode;

  if (commandScope.config.permissionMode != null) return commandScope.config.permissionMode;

  return "auto";
};

const readStatusToolCallCount = (commandScope: CommandSession): number => {
  const liveCount = commandScope.statusline?.toolCallCount();

  const hasLiveCount = liveCount != null;
  if (hasLiveCount) return liveCount;

  return 0;
};

const readStatusTunnelLabel = (commandScope: CommandSession): string => {
  if (commandScope.config.tunnelUrl == null || commandScope.config.tunnelUrl === "") return "none";

  return commandScope.config.tunnelUrl;
};

const readStatusConnectorLabel = (commandScope: CommandSession): string => {
  const connector = readMcpConnectorUrl(commandScope.config.tunnelUrl);

  const isConnectorMissing = connector == null;
  if (isConnectorMissing) return "none";

  return connector;
};

const createBrowserDebugStatus = (status: BrowserStatus): string => {
  return [
    `State: ${status.state}`,
    `Chrome running: ${status.chromeRunning ? "yes" : "no"}`,
    `Debug port: ${status.debugPortListening ? "ready" : "closed"} (${status.port})`,
    `Can attach: ${status.canAttach ? "yes" : "no"}`,
    `Profile root: ${readBrowserProfileRootLabel(status)}`,
    `Message: ${status.message}`,
  ].join(NEWLINE);
};

const readBrowserProfileRootLabel = (status: BrowserStatus): string => {
  const hasStatusUserDir = status.userDataDir != null;
  if (hasStatusUserDir) return status.userDataDir;

  return status.bridgeProfileRoot;
};

const createCacheInventory = (inventory: CacheInventory): string => {
  const lines = [
    `Chrome profile root: ${inventory.profileRoot}`,
    `Reclaimable generated cache: ${inventory.reclaimableBytes} bytes`,
    "",
    SAFE_CACHE_TARGETS_HEADING,
  ];

  for (const line of inventory.entries) {
    const exists = line.exists ? `${line.bytes} bytes` : "missing";
    lines.push(`  ${line.relativePath.padEnd(40)} ${exists}`);
  }

  return lines.join(NEWLINE);
};

const createCachePruneReport = (report: PruneCacheReport): string => {
  return [
    `Chrome profile root: ${report.profileRoot}`,
    `Mode: ${report.dryRun ? "dry-run" : "confirmed prune"}`,
    `Deleted generated cache: ${report.deletedBytes} bytes`,
    "",
    SAFE_CACHE_TARGETS_HEADING,
    ...report.entries.map((line) => {
      const status = line.exists ? `${line.bytes} bytes` : "missing";
      return `  ${line.relativePath.padEnd(40)} ${status}`;
    }),
  ].join(NEWLINE);
};

const createMcpDiagnostics = (commandScope: CommandSession): string => {
  const toolCallCount = readStatusToolCallCount(commandScope);

  return [
    MCP_DIAGNOSTICS_HEADING,
    `Local server: http://localhost:${commandScope.config.mcpPort}`,
    `Tunnel: ${readStatusTunnelLabel(commandScope)}`,
    `Connector: ${readStatusConnectorLabel(commandScope)}`,
    `Tools: ${[...toolRegistry.keys()].join(LIST_SEPARATOR)}`,
    `Tool calls observed this session: ${toolCallCount}`,
    `Status: ${readMcpToolCallStatusLabel(toolCallCount)}`,
    "",
    "If ChatGPT says it cannot access local files:",
    "1. Startup automatically syncs the current Connector URL into ChatGPT when browser automation is connected.",
    "2. Run /connector only to retry that browser setup flow after a UI drift or account permission issue.",
    "3. Ask explicitly: use the ai-browser-bridge connector; do not answer from memory.",
    "4. A reply mentioning /mnt/data, upload a zip, or paste tree/find output means ChatGPT is not using this local connector.",
  ].join(NEWLINE);
};

const readMcpToolCallStatusLabel = (toolCallCount: number): string => {
  const hasToolCalls = toolCallCount > 0;
  if (hasToolCalls) return "MCP tool calls observed in this bridge session.";

  return "No MCP tool calls observed yet; the current ChatGPT chat may not have the connector enabled.";
};

const createConnectorSetupReport = (report: ConnectorSetupReport): string => {
  const isStepsNotEmpty = report.steps.length > 0;
  const isWarningsNotEmpty = report.warnings.length > 0;

  return [
    "",
    "Connector setup result:",
    `URL: ${report.connectorUrl}`,
    `Submitted: ${report.completed ? "yes" : "no"}`,
    ...(isStepsNotEmpty ? ["", "Steps:", ...report.steps.map((step) => `- ${step}`)] : []),
    ...(isWarningsNotEmpty
      ? ["", "Needs manual attention:", ...report.warnings.map((warning) => `- ${warning}`)]
      : []),
    "",
    "Automatic startup handles this on each restart when the browser is connected. Manual fallback: ChatGPT Settings -> Apps -> Advanced settings -> Create app, paste the Connector URL, choose no authentication, then enable it in Developer Mode for this chat.",
  ].join(NEWLINE);
};

const printAttachmentTable = (attachments: Attachment[]): void => {
  const isAttachmentsEmpty = attachments.length === 0;
  if (isAttachmentsEmpty) {
    console.log("No attachments captured in this conversation yet.");
    return;
  }

  const tableLines = [
    ["id", "role", "kind", "filename", "message"],
    ...attachments.map((attachment) => [
      attachment.id,
      attachment.role,
      attachment.kind,
      attachment.filename == null ? "" : attachment.filename,
      String(attachment.messageIndex),
    ]),
  ];
  const widths = computeColumnWidths(tableLines);
  for (const cells of tableLines) {
    console.log(createTableLine({ row: cells, widths }));
  }
};

const computeColumnWidths = (tableLines: string[][]): number[] => {
  const header = tableLines[0];

  const isHeaderMissing = header == null;
  if (isHeaderMissing) return [];

  return header.map((...argumentList: [string, number]) =>
    readMaxColumnLength({ rows: tableLines, column: argumentList[1] }),
  );
};

const readMaxColumnLength = (details: { rows: string[][]; column: number }): number => {
  return Math.max(
    ...details.rows.map((cells) => {
      const cell = cells[details.column];

      const isCellMissing = cell == null;
      if (isCellMissing) return 0;

      return cell.length;
    }),
  );
};

const createTableLine = (details: { row: string[]; widths: number[] }): string => {
  return details.row
    .map((...argumentList: [string, number]) =>
      padTableCell({ cell: argumentList[0], column: argumentList[1], widths: details.widths }),
    )
    .join("  ");
};

const padTableCell = (details: { cell: string; column: number; widths: number[] }): string => {
  const width = details.widths[details.column];

  const isWidthMissing = width == null;
  if (isWidthMissing) return details.cell;

  return details.cell.padEnd(width);
};

const splitArgumentList = (details: string): string[] => {
  const argumentList: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (const char of details.trim()) {
    const next = consumeSplitChar({ char, quote, current, args: argumentList });
    current = next.current;
    quote = next.quote;
  }

  return finalizeSplitArgumentList({ current, args: argumentList });
};

const finalizeSplitArgumentList = (details: { current: string; args: string[] }): string[] => {
  // Empty current means no trailing token ("" is a valid string, not "absent").
  const isCurrentNotEmpty = details.current !== "";
  if (isCurrentNotEmpty) details.args.push(details.current);

  return details.args;
};

const consumeSplitChar = (details: {
  char: string;
  quote: "'" | '"' | null;
  current: string;
  args: string[];
}): { current: string; quote: "'" | '"' | null } => {
  if ((details.char === "'" || details.char === '"') && details.quote == null) {
    return { current: details.current, quote: details.char };
  }

  if (details.char === details.quote) return { current: details.current, quote: null };

  if (/\s/.test(details.char) && details.quote == null) {
    const isCurrentNotEmpty = details.current !== "";
    if (isCurrentNotEmpty) details.args.push(details.current);

    return { current: "", quote: details.quote };
  }

  return { current: details.current + details.char, quote: details.quote };
};

type RuntimeOrchestrator = {
  page?: Page | null;
};

const readCurrentPage = (commandScope: CommandSession): Page | null => {
  const orchestrator = commandScope.orchestrator as CommandSession["orchestrator"] &
    RuntimeOrchestrator;

  const isBrowserPageClosed = orchestrator.page == null;
  if (isBrowserPageClosed) return null;

  return orchestrator.page;
};

const readConversationIdFromPage = (page: Page): string => {
  const conversationId = readChatGptConversationIdFromUrl(page.url());

  const isConversationIdMissing = conversationId == null;
  if (isConversationIdMissing) return "current";

  return conversationId;
};

const parseOutDir = (argumentList: string[]): string | undefined => {
  const outIndex = argumentList.indexOf("--out");

  const isOutMarkerNotFound = outIndex === -1;
  if (isOutMarkerNotFound) return undefined;

  return argumentList[outIndex + 1];
};

const printError = (message: string): void => {
  console.error(`${"\u001b[31m"}${message}${"\u001b[0m"}`);
};

type FilesDownloadDetails = {
  page: Page;
  conversationId: string;
  parts: string[];
  manifestIds: string[];
  repoRoot: string;
};

const downloadFilesCommand = async (details: FilesDownloadDetails): Promise<void> => {
  const outDir = parseOutDir(details.parts.slice(2));

  if (details.parts[1] === "all") {
    const reports = await downloadAll(details.page, details.conversationId, {
      repoRoot: details.repoRoot,
      manifestRoot: readDownloadsDirectory(details.repoRoot),
      ...(outDir ? { outDir } : {}),
    });
    printBulkDownloadReports(reports);
    return;
  }

  await downloadOneAttachment({ input: details, outDir });
};

const downloadOneAttachment = async (details: {
  input: FilesDownloadDetails;
  outDir: string | undefined;
}): Promise<void> => {
  const id = details.input.parts[1];

  const isIdBlank = id == null || id === "";
  if (isIdBlank) {
    printError("Usage: download <attachment-id>");
    return;
  }

  const isNotIdInManifestIds = !details.input.manifestIds.includes(id);
  if (isNotIdInManifestIds) {
    printError(`No attachment with id "${id}".`);
    return;
  }

  const downloaded = await downloadAttachment({
    page: details.input.page,
    conversationId: details.input.conversationId,
    id,
    settings: {
      repoRoot: details.input.repoRoot,
      manifestRoot: readDownloadsDirectory(details.input.repoRoot),
      ...(details.outDir ? { outDir: details.outDir } : {}),
    },
  });
  console.log(downloaded.path);
};

const printBulkDownloadReports = (
  reports: ReadonlyArray<{ id: string; path: string; bytes: number; error?: string }>,
): void => {
  const succeeded = reports.filter((element) => element.error == null).length;
  const failed = reports.length - succeeded;
  let summary = `Downloaded ${succeeded}/${reports.length} attachments`;

  const hasFailures = failed > 0;
  if (hasFailures) summary = `${summary} (${failed} failed)`;

  console.log(`${summary}.`);
  for (const element of reports) {
    const isElementFailed = element.error != null;
    if (isElementFailed) {
      printError(`${element.id}: ${element.error}`);
      continue;
    }

    console.log(`${element.id} -> ${element.path} (${element.bytes} bytes)`);
  }
};

const filesCommand: CommandDef = {
  name: "files",
  description: "List or download ChatGPT conversation attachments",
  handler: (...argumentList: [string, CommandSession]) =>
    runRouteFilesCommand({ args: argumentList[0], ctx: argumentList[1] }),
};

const runRouteFilesCommand = async (details: {
  args: string;
  ctx: CommandSession;
}): Promise<void> => {
  const scope = await loadFilesScope(details);
  const parts = splitArgumentList(details.args);

  const isPartsEmpty = parts.length === 0;
  if (isPartsEmpty) return printAttachmentTable(scope.manifest.attachments);

  await runRouteFilesDownload({ parts, context: scope });
};

const loadFilesScope = async (details: { args: string; ctx: CommandSession }) => {
  const page = readCurrentPage(details.ctx);
  const conversationId = page ? readConversationIdFromPage(page) : "current";
  const manifest = await loadManifest(conversationId, {
    manifestRoot: readDownloadsDirectory(details.ctx.config.repoPath),
  });

  return { page, conversationId, manifest, repoRoot: details.ctx.config.repoPath };
};

const runRouteFilesDownload = async (details: {
  parts: string[];
  context: {
    page: Page | undefined;
    conversationId: string;
    manifest: Awaited<ReturnType<typeof loadManifest>>;
    repoRoot: string;
  };
}): Promise<void> => {
  if (details.parts[0] !== "get")
    return console.log("Usage: /files [get <id>|get all [--out <dir>]]");

  if (!details.parts[1])
    return console.log("Usage: /files get <id> or /files get all [--out <dir>]");

  if (details.context.page == null) {
    printError("Browser not connected. Cannot download attachments.");
    return;
  }

  await downloadFilesCommand({
    page: details.context.page,
    conversationId: details.context.conversationId,
    parts: details.parts,
    manifestIds: details.context.manifest.attachments.map((element) => element.id),
    repoRoot: details.context.repoRoot,
  });
};

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
  ctx: CommandSession;
};

const readRequestedOrCurrentSessionId = async (
  parameters: SessionIdDetails,
): Promise<string | null> => {
  const [requested] = splitArgumentList(parameters.args);
  if (requested) return requested;

  if (parameters.ctx.session?.getId()) return parameters.ctx.session.getId();

  const latest = await getLatestSession(readSessionStore(parameters.ctx.config.repoPath));

  const isLatestMissing = latest == null;
  if (isLatestMissing) return null;

  return latest.metadata.id;
};

type RepositoryFileDetails = {
  repoRoot: string;
  input: string;
};

const createRepositoryFilePath = (parameters: RepositoryFileDetails): string => {
  if (isAbsolute(parameters.input)) {
    const rel = relative(resolve(parameters.repoRoot), resolve(parameters.input));
    return readRepositoryPath(parameters.repoRoot, rel || ".");
  }

  return readRepositoryPath(parameters.repoRoot, parameters.input);
};

const assertImagePath = (path: string): void => {
  const extension = extname(path).toLowerCase();

  const isNotImageExtension = ![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extension);
  if (isNotImageExtension) {
    throw new Error(`Unsupported image type: ${basename(path)}`);
  }
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
    if (error) details.reject(error);
    else details.resolve();
  });
  child.stdin?.end(details.text);
};

type CaptureUrlScreenshotsParameters = {
  url: string;
  repoPath: string;
};

const captureUrlScreenshots = async (
  parameters: CaptureUrlScreenshotsParameters,
): Promise<string[]> => {
  const parsed = parseCaptureUrl(parameters.url);
  const dir = await prepareScreenshotDir(parameters.repoPath);
  return await captureWithPlaywright({ parsed, dir });
};

const parseCaptureUrl = (url: string): string => {
  const parsed = new URL(url);

  const isNotHttpProtocol = !["http:", "https:"].includes(parsed.protocol);
  if (isNotHttpProtocol) {
    throw new Error("Only http and https URLs are supported.");
  }

  return parsed.toString();
};

const prepareScreenshotDir = async (repoPath: string): Promise<string> => {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(readScreenshotsDirectory(repoPath), stamp);
  await mkdir(dir, { recursive: true });
  return dir;
};

type CaptureWithPlaywrightParameters = {
  parsed: string;
  dir: string;
};

const captureWithPlaywright = async (
  parameters: CaptureWithPlaywrightParameters,
): Promise<string[]> => {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const printouts: string[] = [];

  try {
    const viewports = [
      { name: "desktop", width: 1440, height: 1000 },
      { name: "mobile", width: 390, height: 844 },
    ];
    for (const viewport of viewports) {
      printouts.push(
        await captureViewport({
          browser,
          viewport,
          parsed: parameters.parsed,
          dir: parameters.dir,
        }),
      );
    }
  } finally {
    await browser.close();
  }

  return printouts;
};

type CaptureViewportParameters = {
  browser: Awaited<ReturnType<Awaited<typeof import("playwright")>["chromium"]["launch"]>>;
  viewport: { name: string; width: number; height: number };
  parsed: string;
  dir: string;
};

const captureViewport = async (parameters: CaptureViewportParameters): Promise<string> => {
  const page = await parameters.browser.newPage({
    viewport: { width: parameters.viewport.width, height: parameters.viewport.height },
  });

  await page.goto(parameters.parsed, { waitUntil: "networkidle", timeout: 45_000 });

  const file = await writeViewportScreenshot({
    page,
    viewport: parameters.viewport,
    dir: parameters.dir,
  });

  await page.close();

  return file;
};

const writeViewportScreenshot = async (details: {
  page: Awaited<ReturnType<CaptureViewportParameters["browser"]["newPage"]>>;
  viewport: CaptureViewportParameters["viewport"];
  dir: string;
}): Promise<string> => {
  const file = join(details.dir, `${details.viewport.name}.png`);
  await details.page.screenshot({ path: file, fullPage: true });
  return file;
};

type SessionExportSelection = {
  sessionId: string | null;
  outputPath?: string;
};

type SessionExportParameters = {
  args: string;
  ctx: CommandSession;
};

const readSessionExportFromArgumentList = async (
  parameters: SessionExportParameters,
): Promise<SessionExportSelection> => {
  const parts = splitArgumentList(parameters.args);

  const isPartsEmpty = parts.length === 0;
  if (isPartsEmpty) {
    return { sessionId: await readRequestedOrCurrentSessionId({ args: "", ctx: parameters.ctx }) };
  }

  return readSessionExportFromParts({ parts, ctx: parameters.ctx });
};

const readSessionExportFromParts = async (details: {
  parts: string[];
  ctx: CommandSession;
}): Promise<SessionExportSelection> => {
  const first = details.parts[0] ?? "";
  const store = readSessionStore(details.ctx.config.repoPath);

  const session = await tryLoadSession({ sessionId: first, options: store });

  const hasSession = session != null;
  if (hasSession) {
    return {
      sessionId: session.metadata.id,
      outputPath: details.parts[1] ? resolve(details.parts[1]) : undefined,
    };
  }

  return {
    sessionId: await readRequestedOrCurrentSessionId({ args: "", ctx: details.ctx }),
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

const runNewCommand = async (
  _argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  await commandScope.orchestrator.openNewConversation();
  console.log("Started new conversation.");
};

const stopReplyCommand = async (
  _argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  const stopped = await commandScope.orchestrator.stopReply();
  console.log(stopped ? "Stopped active response." : "No active response to stop.");
};

const requestCompactCommand = async (
  _argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  await commandScope.sendMessage(
    "Summarize our progress so far in a structured format: what we've done, what's in progress, what's next. Be concise.",
  );
  console.log(
    "Compaction summary requested. Start a new conversation to continue with that summary.",
  );
};

const showLogsCommand = async (
  _argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  console.log(`Bridge logs: ${readBridgeLogPath(commandScope.config.repoPath)}`);
};

const showStatusCommand = async (
  _argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  console.log(createBridgeStatus(commandScope));
};

const showStatuslineCommand = async (
  _argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  console.log(createBridgeStatus(commandScope));
};

const clearChatCommand = async (
  _argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  commandScope.clearMessages?.();
  console.log(
    "Cleared terminal chat view. Browser conversation, context estimate, and local session logs are unchanged.",
  );
};

const requestDiffCommand = async (
  _argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  await commandScope.sendMessage("Show me the current git diff for the repository.");
};

const exitBridgeCommand = async (
  _argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  if (commandScope.shutdown) {
    await commandScope.shutdown();
    return;
  }

  console.log("Shutting down...");
};

const showHelpCommand = async (
  _argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  const all = listRegisteredCommands();

  console.log("\nAvailable commands:\n");

  for (const cmd of all) {
    console.log(`  /${cmd.name.padEnd(16)} ${cmd.description}`);
  }

  await printCustomCommands(commandScope);
  console.log("");
};

const printCustomCommands = async (commandScope: CommandSession): Promise<void> => {
  const custom = await loadCustomCommands({ repoRoot: commandScope.config.repoPath });

  const isCustomEmpty = custom.length === 0;
  if (isCustomEmpty) return;

  console.log(CUSTOM_COMMANDS_HEADING);
  for (const cmd of custom) {
    const description = cmd.description == null ? `${cmd.source} command` : cmd.description;
    console.log(`  /${cmd.name.padEnd(16)} ${description}`);
  }
};

const listCustomCommandsCommand = async (
  _argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  const custom = await loadCustomCommands({ repoRoot: commandScope.config.repoPath });

  const isCustomEmpty = custom.length === 0;
  if (isCustomEmpty) {
    console.log("No custom commands found in .bridge/commands or ~/.ai-browser-bridge/commands.");
    return;
  }

  console.log(CUSTOM_COMMANDS_HEADING);
  for (const command of custom) {
    const description =
      command.description == null ? `${command.source} command` : command.description;
    console.log(`  /${command.name.padEnd(16)} ${description}`);
  }
  console.log("");
};

const attachImageCommand = async (
  argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  const target = argumentList.trim();

  const isTargetEmpty = !target;
  if (isTargetEmpty) {
    console.log("Usage: /attach-image <repo-relative-image-path>");
    return;
  }

  await attachRepoImage({ target, ctx: commandScope });
};

const attachRepoImage = async (details: { target: string; ctx: CommandSession }): Promise<void> => {
  const imagePath = createRepositoryFilePath({
    repoRoot: details.ctx.config.repoPath,
    input: details.target,
  });
  assertImagePath(imagePath);

  if (!details.ctx.orchestrator.attachFiles) {
    console.log("Browser file attachment is not available.");
    return;
  }

  await details.ctx.orchestrator.attachFiles([imagePath]);
  console.log(`Attached image: ${imagePath}`);
};

const captureScreenshotCommand = async (
  argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  const url = argumentList.trim();

  const isUrlEmpty = !url;
  if (isUrlEmpty) {
    console.log("Usage: /screenshot <url>");
    return;
  }

  const files = await captureUrlScreenshots({ url, repoPath: commandScope.config.repoPath });
  printScreenshotPaths(files);
};

const runUiQaCommand = async (
  argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  const url = argumentList.trim();

  const isUrlEmpty = !url;
  if (isUrlEmpty) {
    console.log("Usage: /ui-qa <url>");
    return;
  }

  const files = await runUiQaCapture({ url, ctx: commandScope });
  console.log(`UI QA requested with ${files.length} screenshots.`);
};

const runUiQaCapture = async (details: { url: string; ctx: CommandSession }): Promise<string[]> => {
  const files = await captureUrlScreenshots({
    url: details.url,
    repoPath: details.ctx.config.repoPath,
  });

  if (details.ctx.orchestrator.attachFiles) await details.ctx.orchestrator.attachFiles(files);

  await sendUiQaPrompt({ url: details.url, files, ctx: details.ctx });
  return files;
};

const printScreenshotPaths = (files: string[]): void => {
  console.log("Screenshots:");
  for (const file of files) console.log(`  ${file}`);
};

type SendUiQaPromptParameters = {
  url: string;
  files: string[];
  ctx: CommandSession;
};

const sendUiQaPrompt = async (parameters: SendUiQaPromptParameters): Promise<void> => {
  await parameters.ctx.sendMessage(
    [
      `Review the UI at ${parameters.url}.`,
      "I attached desktop and mobile screenshots when the browser supports file attachment.",
      "Focus on layout breakage, overlapping text, responsive behavior, accessibility, and concrete fixes.",
      "",
      "Screenshot files:",
      ...parameters.files.map((file) => `- ${file}`),
    ].join(NEWLINE),
  );
};

const BROWSER_HANDLERS: Record<
  string,
  (argumentList: string, commandScope: CommandSession) => Promise<void>
> = {
  help: showHelpCommand,
  new: runNewCommand,
  stop: stopReplyCommand,
  compact: requestCompactCommand,
  commands: listCustomCommandsCommand,
  logs: showLogsCommand,
  status: showStatusCommand,
  statusline: showStatuslineCommand,
  clear: clearChatCommand,
  "attach-image": attachImageCommand,
  screenshot: captureScreenshotCommand,
  "ui-qa": runUiQaCommand,
  diff: requestDiffCommand,
  exit: exitBridgeCommand,
};

const listConversationsCommand = async (
  argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  const hasArgumentList = argumentList.trim();
  if (hasArgumentList) {
    await openMatchingConversation({ query: argumentList.trim(), ctx: commandScope });
    return;
  }

  const conversations = await commandScope.orchestrator.listConversations();

  const isConversationsEmpty = conversations.length === 0;
  if (isConversationsEmpty) {
    console.log("No conversations found in sidebar.");
    return;
  }

  printConversationList(conversations);
};

type OpenMatchingConversationParameters = {
  query: string;
  ctx: CommandSession;
};

const openMatchingConversation = async (
  parameters: OpenMatchingConversationParameters,
): Promise<void> => {
  const [hit] = await parameters.ctx.orchestrator.searchConversations({
    query: parameters.query,
    limit: 1,
  });

  const hasHit = hit != null;
  if (hasHit) {
    console.log(`Navigating to: ${hit.title} (${hit.id})`);
    await parameters.ctx.orchestrator.navigateToConversation(hit.url);
    return;
  }

  console.log(`No conversation matching "${parameters.query}".`);
};

const printConversationList = (conversations: Array<{ id: string; title: string }>): void => {
  console.log("\nChatGPT Conversations:\n");
  conversations.forEach((conversation, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${conversation.title}`);
  });
  console.log("\nUse /resume <number> to continue a conversation.\n");
};

const listSessionsCommand = async (
  _argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  const sessions = await listSessions(readSessionStore(commandScope.config.repoPath));

  const isSessionsEmpty = sessions.length === 0;
  if (isSessionsEmpty) {
    console.log(NO_SESSIONS_MESSAGE);
    return;
  }

  printSessions({ sessions, currentId: commandScope.session?.getId() });
};

type PrintSessionStoredParameters = {
  sessions: Array<{ id: string; updatedAt: string; model?: string | null; repoPath: string }>;
  currentId?: string;
};

const printSessions = (parameters: PrintSessionStoredParameters): void => {
  console.log("\nLocal sessions:\n");

  for (const session of parameters.sessions.slice(0, 20)) {
    const marker = session.id === parameters.currentId ? "*" : SPACE;
    console.log(
      `${marker} ${session.id.padEnd(38)} ${session.updatedAt} ${readSessionModelLabel(session.model)} ${session.repoPath}`,
    );
  }

  console.log("\nUse /resume --last or /resume <session-id> to make a session current.\n");
};

const resumeSessionCommand = async (
  argumentList: string,
  commandScope: CommandSession,
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
    await resumeLatestSession(commandScope);
    return;
  }

  const isSessionResumed = await resumeLocalSession({ query, ctx: commandScope });
  if (isSessionResumed) return;

  await resumeBrowserConversation({ query, ctx: commandScope });
};

const resumeLatestSession = async (commandScope: CommandSession): Promise<void> => {
  const latest = await getLatestSession(readSessionStore(commandScope.config.repoPath));

  const isLatestMissing = latest == null;
  if (isLatestMissing) {
    console.log(NO_SESSIONS_MESSAGE);
    return;
  }

  await commandScope.session?.setId(latest.metadata.id);
  console.log(createSessionSummary(latest.metadata, commandScope.session?.getId()));
};

type ResumeLocalSessionParameters = {
  query: string;
  ctx: CommandSession;
};

const resumeLocalSession = async (parameters: ResumeLocalSessionParameters): Promise<boolean> => {
  const localSession = await tryLoadSession({
    sessionId: parameters.query,
    options: readSessionStore(parameters.ctx.config.repoPath),
  });

  const isLocalSessionMissing = localSession == null;
  if (isLocalSessionMissing) return false;

  await parameters.ctx.session?.setId(localSession.metadata.id);
  console.log(createSessionSummary(localSession.metadata, parameters.ctx.session?.getId()));
  return true;
};

type ResumeBrowserConversationParameters = {
  query: string;
  ctx: CommandSession;
};

const resumeBrowserConversation = async (
  parameters: ResumeBrowserConversationParameters,
): Promise<void> => {
  const target = await findBrowserConversation({ ctx: parameters.ctx, query: parameters.query });

  const isTargetEmpty = !target;
  if (isTargetEmpty) {
    console.log(
      `No conversation matching "${parameters.query}". Use /conversations to see the list.`,
    );
    return;
  }

  console.log(`Resuming: ${target.title}`);
  await parameters.ctx.orchestrator.navigateToConversation(target.url);
};

const findBrowserConversation = async (details: {
  ctx: CommandSession;
  query: string;
}): Promise<{ id: string; title: string; url: string } | undefined> => {
  const num = Number.parseInt(details.query, 10);

  const isNumNaN = Number.isNaN(num);
  if (isNumNaN) {
    const [hit] = await details.ctx.orchestrator.searchConversations({
      query: details.query,
      limit: 1,
    });
    return hit;
  }

  const conversations = await details.ctx.orchestrator.listConversations();
  return conversations[num - 1];
};

const showTranscriptCommand = async (
  argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  const sessionId = await readRequestedOrCurrentSessionId({
    args: argumentList,
    ctx: commandScope,
  });

  const isSessionIdEmpty = !sessionId;
  if (isSessionIdEmpty) {
    console.log(NO_SESSION_SELECTED_MESSAGE);
    return;
  }

  const exported = await exportSession(sessionId, readSessionStore(commandScope.config.repoPath));
  console.log(trimPrintout(exported.transcript || "(empty transcript)", 40_000));
};

const copyTranscriptCommand = async (
  argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  const sessionId = await readRequestedOrCurrentSessionId({
    args: argumentList,
    ctx: commandScope,
  });

  const isSessionIdEmpty = !sessionId;
  if (isSessionIdEmpty) {
    console.log(NO_SESSION_SELECTED_MESSAGE);
    return;
  }

  const exported = await exportSession(sessionId, readSessionStore(commandScope.config.repoPath));
  await copyToClipboard(exported.transcript);
  console.log(`Copied transcript for ${sessionId} to clipboard.`);
};

const exportTranscriptCommand = async (
  argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  const selection = await readSessionExportFromArgumentList({
    args: argumentList,
    ctx: commandScope,
  });

  const isSelectionSessionIdEmpty = !selection.sessionId;
  if (isSelectionSessionIdEmpty) {
    console.log(NO_SESSION_SELECTED_MESSAGE);
    return;
  }

  await writeSessionExport({
    sessionId: selection.sessionId,
    outputPath: selection.outputPath,
    ctx: commandScope,
  });
};

type WriteSessionExportParameters = {
  sessionId: string;
  outputPath?: string;
  ctx: CommandSession;
};

const writeSessionExport = async (parameters: WriteSessionExportParameters): Promise<void> => {
  const store = readSessionStore(parameters.ctx.config.repoPath);
  const exported = await exportSession(parameters.sessionId, store);
  const targetPath =
    parameters.outputPath == null
      ? readDefaultExportPath({
          repoPath: parameters.ctx.config.repoPath,
          sessionId: parameters.sessionId,
        })
      : parameters.outputPath;

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

const listCheckpointsCommand = async (
  _argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  const checkpoints = await listCheckpoints({ repoRoot: commandScope.config.repoPath });

  const isCheckpointsEmpty = checkpoints.length === 0;
  if (isCheckpointsEmpty) {
    console.log("No checkpoints found.");
    return;
  }

  printCheckpoints(checkpoints);
};

const printCheckpoints = (
  checkpoints: Array<{ id: string; phase: string; fileCount: number; label?: string }>,
): void => {
  console.log("\nCheckpoints:\n");

  for (const checkpoint of checkpoints.slice(0, 20)) {
    console.log(
      `  ${checkpoint.id.padEnd(38)} ${checkpoint.phase.padEnd(6)} ${checkpoint.fileCount} files ${readCheckpointLabel(checkpoint.label)}`,
    );
  }

  console.log("\nUse /restore <checkpoint-id> or /rewind --files <checkpoint-id>.\n");
};

const readCheckpointLabel = (label: string | undefined): string => {
  const isLabelMissing = label == null;
  if (isLabelMissing) return "";

  return label;
};

const restoreCheckpointCommand = async (
  argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  const parts = splitArgumentList(argumentList);

  const checkpointId = parts[0];

  const isCheckpointIdEmpty = !checkpointId;
  if (isCheckpointIdEmpty) {
    console.log("Usage: /restore <checkpoint-id> [path ...]");
    return;
  }

  const restored = await restoreCheckpoint({
    repoRoot: commandScope.config.repoPath,
    checkpointId,
    paths: parts.slice(1),
  });
  console.log(
    `Restored checkpoint ${checkpointId}: ${restored.restored.length} restored, ${restored.removed.length} removed.`,
  );
};

const runRewindPromptCommand = async (
  argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  const parts = splitArgumentList(argumentList);
  const isFilesOrBothFlag = parts[0] === FILES_FLAG || parts[0] === "--both";

  if (isFilesOrBothFlag) {
    await rewindWithCheckpoint({ mode: parts[0], parts, ctx: commandScope });
    return;
  }

  const replacement = argumentList.trim() || undefined;
  await commandScope.orchestrator.rewindLastPrompt(replacement);
  console.log(replacement ? "Rewound with replacement prompt." : "Rewound the last prompt.");
};

type RewindWithCheckpointParameters = {
  mode: string;
  parts: string[];
  ctx: CommandSession;
};

const rewindWithCheckpoint = async (parameters: RewindWithCheckpointParameters): Promise<void> => {
  const checkpointId = parameters.parts[1];

  const isCheckpointIdEmpty = !checkpointId;
  if (isCheckpointIdEmpty) {
    console.log(`Usage: /rewind ${parameters.mode} <checkpoint-id> [replacement prompt]`);
    return;
  }

  await restoreAndMaybeRewind(parameters, checkpointId);
};

const restoreAndMaybeRewind = async (
  parameters: RewindWithCheckpointParameters,
  checkpointId: string,
): Promise<void> => {
  const restored = await restoreCheckpoint({
    repoRoot: parameters.ctx.config.repoPath,
    checkpointId,
  });
  console.log(
    `Restored checkpoint ${checkpointId}: ${restored.restored.length} restored, ${restored.removed.length} removed.`,
  );

  const isModeFiles = parameters.mode === FILES_FLAG;
  if (isModeFiles) return;

  await rewindPromptAfterRestore(parameters);
};

const rewindPromptAfterRestore = async (
  parameters: RewindWithCheckpointParameters,
): Promise<void> => {
  const replacement = parameters.parts.slice(2).join(SPACE).trim() || undefined;

  await parameters.ctx.orchestrator.rewindLastPrompt(replacement);
  console.log(
    replacement
      ? "Restored files and rewound with replacement prompt."
      : "Restored files and rewound the last prompt.",
  );
};

const SESSION_HANDLERS: Record<
  string,
  (argumentList: string, commandScope: CommandSession) => Promise<void>
> = {
  conversations: listConversationsCommand,
  resume: resumeSessionCommand,
  sessions: listSessionsCommand,
  transcript: showTranscriptCommand,
  copy: copyTranscriptCommand,
  export: exportTranscriptCommand,
  checkpoints: listCheckpointsCommand,
  restore: restoreCheckpointCommand,
  rewind: runRewindPromptCommand,
};

const isProviderMissingMcpConnector = (commandScope: CommandSession): boolean => {
  return !readProvider(commandScope.config.provider).supportsMcpConnector;
};

const showMcpCommand = async (
  _argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  const isMcpConnectorMissing = isProviderMissingMcpConnector(commandScope);
  if (isMcpConnectorMissing) {
    printNoMcpDiagnostics(commandScope);
    return;
  }

  console.log(createMcpDiagnostics(commandScope));
};

const printNoMcpDiagnostics = (commandScope: CommandSession): void => {
  const label = readProviderDisplayName(readProviderIdFrom(commandScope.config.provider));

  console.log(
    [
      MCP_DIAGNOSTICS_HEADING,
      `Provider: ${label} web`,
      `Local MCP tools are not available in the ${label} web UI.`,
      "Use @file mentions to inline repo files into prompts.",
      "",
      "For full MCP tools, run with --provider chatgpt, claude, or grok.",
    ].join(NEWLINE),
  );
};

const openConnectorCommand = async (
  _argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  const isMcpConnectorMissing = isProviderMissingMcpConnector(commandScope);
  if (isMcpConnectorMissing) {
    printNoConnectorWarning(commandScope);
    return;
  }

  const connector = readMcpConnectorUrl(commandScope.config.tunnelUrl);

  const isConnectorEmpty = !connector;
  if (isConnectorEmpty) {
    printMissingConnectorUrl(commandScope);
    return;
  }

  await openConnectorSetup({ connector, ctx: commandScope });
};

const printNoConnectorWarning = (commandScope: CommandSession): void => {
  const label = readProviderDisplayName(readProviderIdFrom(commandScope.config.provider));
  console.log(
    `${label} web has no custom MCP connector UI. Use @file mentions for read-only repo context, or run with --provider chatgpt, claude, or grok for full MCP tools.`,
  );
};

const printMissingConnectorUrl = (commandScope: CommandSession): void => {
  console.log(
    [
      "No public connector URL is available.",
      `Local MCP server: http://localhost:${commandScope.config.mcpPort}`,
      "ChatGPT cannot normally reach localhost from the browser connector.",
      "Restart the bridge and fix Cloudflare Tunnel, then run /connector again.",
    ].join(NEWLINE),
  );
};

const openConnectorSetup = async (parameters: {
  connector: string;
  ctx: CommandSession;
}): Promise<void> => {
  console.log(createMcpDiagnostics(parameters.ctx));

  if (!parameters.ctx.orchestrator.openConnectorSetup) {
    console.log(
      "\nBrowser setup automation is unavailable. Open ChatGPT Settings -> Apps -> Advanced settings -> Create app and paste the Connector URL.",
    );
    return;
  }

  const setupReport = await parameters.ctx.orchestrator.openConnectorSetup({
    connectorUrl: parameters.connector,
  });
  console.log(createConnectorSetupReport(setupReport));
};

const runPermissionsCommand = async (
  argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  const next = argumentList.trim();

  const isNextEmpty = !next;
  if (isNextEmpty) {
    printPermissionModes(commandScope);
    return;
  }

  await setPermissionMode({ next, ctx: commandScope });
};

const printPermissionModes = (commandScope: CommandSession): void => {
  console.log(`Permission mode: ${readStatusPermissionLabel(commandScope)}`);
  console.log(`Available: ${PERMISSION_MODES.join(LIST_SEPARATOR)}`);
};

const setPermissionMode = async (parameters: {
  next: string;
  ctx: CommandSession;
}): Promise<void> => {
  const mode = cleanPermissionMode(parameters.next);

  const isNextModeDifferent = mode !== parameters.next;
  if (isNextModeDifferent) {
    console.log(
      `Unknown permission mode "${parameters.next}". Available: ${PERMISSION_MODES.join(LIST_SEPARATOR)}`,
    );
    return;
  }

  await parameters.ctx.permission?.setMode(mode);
  parameters.ctx.config.permissionMode = mode;
  console.log(`Permission mode set to ${mode}.`);
};

const runTaskCommand = async (
  argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  const task = argumentList.trim();

  const isTaskEmpty = task === "";
  if (isTaskEmpty) {
    console.log("Usage: /task <project task>");
    return;
  }

  const isMcpConnectorMissing = isProviderMissingMcpConnector(commandScope);
  if (isMcpConnectorMissing) {
    printNoMcpTaskWarning(commandScope);
    return;
  }

  const instructions = await loadProjectInstructions(commandScope.config.repoPath);
  await commandScope.sendMessage(
    createProjectTaskPromptWithInstructions(task, commandScope, instructions.promptText),
  );
};

const printNoMcpTaskWarning = (commandScope: CommandSession): void => {
  const label = readProviderDisplayName(readProviderIdFrom(commandScope.config.provider));
  console.log(
    `${label} web does not support MCP connectors. /task needs live repo tools — use --provider chatgpt, claude, or grok, or send a normal prompt with @file mentions.`,
  );
};

const runReviewCommand = async (
  argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  const scope = argumentList.trim() || "working";

  await commandScope.sendMessage(
    [
      "Review the local repository changes with a code-review stance.",
      "Prioritize bugs, regressions, security risks, and missing tests.",
      "Use the MCP tools to inspect the repo and diff before making claims.",
      `Review scope: ${scope}`,
    ].join(NEWLINE),
  );
};

const MCP_HANDLERS: Record<
  string,
  (argumentList: string, commandScope: CommandSession) => Promise<void>
> = {
  task: runTaskCommand,
  permissions: runPermissionsCommand,
  mcp: showMcpCommand,
  connector: openConnectorCommand,
  review: runReviewCommand,
};

const runModelCommand = async (
  argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  const query = argumentList.trim();
  if (query) {
    await switchModel({ query, ctx: commandScope });
    return;
  }

  await showCurrentModel(commandScope);
};

const switchModel = async (parameters: { query: string; ctx: CommandSession }): Promise<void> => {
  const model = await parameters.ctx.orchestrator.switchModel(parameters.query);

  parameters.ctx.counter.setModel(model);

  const profile = findModelProfile(model);

  console.log(
    `Model switched to ${model}. Context estimate now uses ${profile.contextWindow.toLocaleString()} tokens.`,
  );
};

const showCurrentModel = async (commandScope: CommandSession): Promise<void> => {
  const current = await commandScope.orchestrator.detectModel();
  commandScope.counter.setModel(current);
  printModelProfile(current);
  await printAvailableModels(commandScope);
};

const printAvailableModels = async (commandScope: CommandSession): Promise<void> => {
  const available = await commandScope.orchestrator.listModels();

  const hasAvailable = available.length > 0;
  if (hasAvailable) {
    printBrowserModels(available);
    return;
  }

  printKnownProfiles();
};

const printModelProfile = (model: string): void => {
  const profile = findModelProfile(model);
  console.log(`\nCurrent model: ${model}`);
  console.log(`Context window: ${profile.contextWindow.toLocaleString()} tokens`);

  if (profile.maxOutputTokens) {
    console.log(`Max output:     ${profile.maxOutputTokens.toLocaleString()} tokens`);
  }

  console.log(`Source:         ${profile.sourceUrl}`);
};

const printBrowserModels = (models: Array<{ label: string; selected?: boolean }>): void => {
  console.log("\nBrowser models:");
  for (const model of models) {
    console.log(`  ${model.selected ? "*" : SPACE} ${model.label}`);
  }
  console.log("\nUse /model <name> to switch.");
};

const printKnownProfiles = (): void => {
  console.log("\nKnown context profiles:");
  for (const model of listModelProfiles()) {
    console.log(`  ${model.label.padEnd(24)} ${model.contextWindow.toLocaleString()} ctx`);
  }
};

const showEstimateCommand = async (
  _argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  console.log(
    `Context estimate for ${commandScope.counter.modelLabel}: ${commandScope.counter.summary}`,
  );
};

const MODEL_HANDLERS: Record<
  string,
  (argumentList: string, commandScope: CommandSession) => Promise<void>
> = {
  model: runModelCommand,
  context: showEstimateCommand,
};

const executeBuiltinCommand = async (details: {
  parsed: { name: string; args: string };
  cmd: CommandDef;
  ctx: CommandSession;
}): Promise<boolean> => {
  try {
    await details.cmd.handler(details.parsed.args, details.ctx);
  } catch (caughtError) {
    const isErrorObject = caughtError instanceof Error;
    const message = isErrorObject ? caughtError.message : String(caughtError);
    console.error(`Command /${details.parsed.name} failed: ${message}`);
  }

  return true;
};

const executeCustomCommand = async (details: {
  parsed: { name: string; args: string };
  ctx: CommandSession;
}): Promise<boolean> => {
  const custom = await findCustomCommand({ name: details.parsed.name, ctx: details.ctx });

  const isCustomEmpty = !custom;
  if (isCustomEmpty) return false;

  await details.ctx.sendMessage(writeCustomCommandPrompt(custom, details.parsed.args));
  return true;
};

const parseCommandLine = (details: string): { name: string; args: string } | null => {
  const trimmed = details.trim();

  const isNotSlashCommand = !trimmed.startsWith("/");
  if (isNotSlashCommand) return null;

  const { name, args: argumentList } = splitCommandNameAndArgumentList(trimmed);

  const isNameEmpty = !name;
  if (isNameEmpty) return null;

  return { name, args: argumentList };
};

const splitCommandNameAndArgumentList = (trimmed: string): { name: string; args: string } => {
  const spaceIndex = trimmed.indexOf(SPACE);
  const isSpaceNotFound = spaceIndex === -1;
  const name = isSpaceNotFound ? trimmed.slice(1) : trimmed.slice(1, spaceIndex);
  const argumentList = isSpaceNotFound ? "" : trimmed.slice(spaceIndex + 1);
  return { name, args: argumentList };
};

const findCustomCommand = async (details: { name: string; ctx: CommandSession }) => {
  const custom = await loadCustomCommands({ repoRoot: details.ctx.config.repoPath });
  return custom.find((command) => command.name === details.name);
};

type CommandHandlerMap = Record<string, CommandDef["handler"]>;

type ComposeCommandsDetails = {
  meta: CommandMeta[];
  handlers: CommandHandlerMap;
};

const composeCommands = (details: ComposeCommandsDetails): CommandDef[] => {
  return details.meta.flatMap((line) => {
    const handler = details.handlers[line.name];

    const isHandlerMissing = handler == null;
    if (isHandlerMissing) return [];

    return [{ name: line.name, description: line.description, aliases: line.aliases, handler }];
  });
};

const BUILTIN_COMMANDS: CommandDef[] = [
  filesCommand,
  ...composeCommands({
    meta: [
      { name: "conversations", description: "List and open ChatGPT conversations" },
      {
        name: "resume",
        aliases: ["open"],
        description: "Resume a browser conversation or local session",
      },
      { name: "sessions", description: "List local bridge sessions" },
      { name: "transcript", description: "Print local session transcript" },
      { name: "copy", description: "Copy local session transcript to clipboard" },
      { name: "export", description: "Export local session transcript" },
      { name: "checkpoints", description: "List file checkpoints" },
      { name: "restore", description: "Restore files from a checkpoint" },
      {
        name: "rewind",
        aliases: ["retry"],
        description: "Edit the last prompt, or restore checkpoint files",
      },
    ],
    handlers: SESSION_HANDLERS,
  }),
  ...composeCommands({
    meta: [
      { name: "model", description: "Show or switch the ChatGPT model" },
      { name: "context", description: "Show context window usage" },
    ],
    handlers: MODEL_HANDLERS,
  }),
  ...composeCommands({
    meta: [
      {
        name: "task",
        aliases: ["work"],
        description: "Send a project-agent task with MCP tool instructions",
      },
      { name: "permissions", description: "Show or switch MCP permission mode" },
      { name: "mcp", description: "Show MCP connector setup and exposed tools" },
      { name: "connector", description: "Open ChatGPT MCP connector setup" },
      { name: "review", description: "Ask ChatGPT to review local changes" },
    ],
    handlers: MCP_HANDLERS,
  }),
  ...composeCommands({
    meta: [
      { name: "help", description: "List all available commands" },
      { name: "new", description: "Start a new ChatGPT conversation" },
      { name: "stop", description: "Stop the active ChatGPT response" },
      { name: "compact", description: "Ask ChatGPT for a concise progress summary" },
      { name: "commands", description: "List project/user custom commands" },
      { name: "logs", description: "Show the local bridge log file path" },
      { name: "status", description: "Show bridge status" },
      { name: "statusline", description: "Show status bar fields" },
      { name: "clear", description: "Clear the terminal chat view" },
      { name: "attach-image", description: "Attach a repo image file to ChatGPT" },
      { name: "screenshot", description: "Capture desktop/mobile screenshots for a URL" },
      { name: "ui-qa", description: "Capture UI screenshots and ask ChatGPT to review them" },
      { name: "diff", description: "Show current git diff" },
      { name: "exit", description: "Shutdown the bridge" },
    ],
    handlers: BROWSER_HANDLERS,
  }),
];

const commands = new Map<string, CommandDef>();
const canonicalNames = new Set<string>();

const registerCommand = (cmd: CommandDef): void => {
  commands.set(cmd.name, cmd);
  canonicalNames.add(cmd.name);

  const aliases = cmd.aliases == null ? [] : cmd.aliases;

  for (const alias of aliases) {
    commands.set(alias, cmd);
  }
};

export const listRegisteredCommands = (): CommandDef[] => {
  const listed: CommandDef[] = [];
  for (const name of canonicalNames) {
    const command = commands.get(name);

    const isCommandMissing = command == null;
    if (isCommandMissing) continue;

    if (command.hidden) continue;

    listed.push(command);
  }
  return listed;
};

export const executeCommand = async (
  details: string,
  commandScope: CommandSession,
): Promise<boolean> => {
  const parsed = parseCommandLine(details);

  const isParsedEmpty = !parsed;
  if (isParsedEmpty) return false;

  const cmd = commands.get(parsed.name);

  const isCommandDefinitionMissing = cmd == null;
  if (isCommandDefinitionMissing) return executeCustomCommand({ parsed, ctx: commandScope });

  return executeBuiltinCommand({ parsed, cmd, ctx: commandScope });
};

export const findCommandsByPartialName = (partial: string): CommandDef[] => {
  const q = partial.toLowerCase();
  return listRegisteredCommands().filter((cmd) => cmd.name.toLowerCase().startsWith(q));
};

for (const command of BUILTIN_COMMANDS) {
  registerCommand(command);
}

const fail = (message: string): never => {
  throw new Error(message);
};

const failUsage = (message: string): never => {
  throw createUsageError(message);
};

// undefined for absent/invalid so the browser layer uses its default wait.
export const convertSecondsToTimeoutMilliseconds = (
  seconds: string | undefined,
): number | undefined => {
  const isSecondsUnset = !seconds;
  if (isSecondsUnset) return undefined;

  const parsed = Number(seconds);

  const isNotPositiveNumber = Number.isNaN(parsed) || parsed <= 0;
  if (isNotPositiveNumber) return undefined;

  return Math.round(parsed * 1000);
};

// Ctrl-C or kill: stop generating before tear-down so warm tabs do not burn quota.
export const stopEngine = async (engine: BridgeEngine): Promise<void> => {
  await Promise.allSettled([engine.getOrchestrator().stopReply()]);
  await Promise.allSettled([engine.shutDown({ closeBrowser: false })]);
};

export const runSessions = async (): Promise<void> => {
  const sessions = await listSessions();
  process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
};

export const runBrowserStatus = async (settings: BrowserStatusSettings = {}): Promise<void> => {
  const status = await readBrowserStatus();

  if (settings.json) process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  else process.stdout.write(`${createBrowserDebugStatus(status)}\n`);
};

const cacheProfileRoot = (settings: CacheCommandSettings): string => {
  return settings.profile ? resolve(settings.profile) : readBridgeChromeProfileRoot();
};

export const runCacheList = async (settings: CacheCommandSettings): Promise<void> => {
  const inventory = await measureChromeCache({
    profileRoot: cacheProfileRoot(settings),
  });

  if (settings.json) process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
  else process.stdout.write(`${createCacheInventory(inventory)}\n`);
};

export const runCachePrune = async (settings: CacheCommandSettings): Promise<void> => {
  const dryRun = settings.dryRun == null ? !settings.yes : settings.dryRun;

  const isNotDryRun = !dryRun;
  if (isNotDryRun) await assertChromeClosedForCachePrune();

  const pruneReport = await pruneChromeCache({
    profileRoot: cacheProfileRoot(settings),
    dryRun,
    confirm: settings.yes,
  });

  if (settings.json) process.stdout.write(`${JSON.stringify(pruneReport, null, 2)}\n`);
  else process.stdout.write(`${createCachePruneReport(pruneReport)}\n`);
};

const assertChromeClosedForCachePrune = async (): Promise<void> => {
  const status = await readBrowserStatus();

  const isChromeNotRunning = !status.chromeRunning;
  if (isChromeNotRunning) return;

  fail("Quit Chrome before pruning generated cache from the shared bridge profile.");
};

const assertSignedIn = async (
  engine: Awaited<ReturnType<typeof startEngine>>,
  browserProvider: ReturnType<typeof readProvider>,
  provider: ReturnType<typeof readProviderIdFrom>,
): Promise<void> => {
  const browser = engine.browser;

  const isBrowserMissing = browser == null;
  if (isBrowserMissing) {
    await engine.shutDown({ closeBrowser: false });
    return fail(
      `Browser not connected. Run \`bridge chrome start --provider ${provider}\` and sign in if needed.`,
    );
  }

  try {
    await browserProvider.assertSignedIn(browser.getPage());
  } catch (error) {
    await engine.shutDown({ closeBrowser: false });
    const isErrorObject = error instanceof Error;
    fail(isErrorObject ? error.message : String(error));
  }
};

type AskedChat = { conversationId: string | null; url: string };

type WriteAskPrintoutScope = {
  engine: Awaited<ReturnType<typeof startEngine>>;
  askedChat: AskedChat;
  reply: Awaited<ReturnType<Awaited<ReturnType<typeof startEngine>>["ask"]>>;
  orchestratorError: string | null;
  options: AskSettings;
  provider: ReturnType<typeof readProviderIdFrom>;
  displayName: string;
};

// Prefer the real orchestrator error over a generic "not logged in" hint.
const writeAskPrintout = (commandScope: WriteAskPrintoutScope): void => {
  const hasNoReply = !commandScope.reply;
  if (hasNoReply) {
    const fallbackHint = `No reply captured — ${commandScope.displayName} may not be logged in, or the page UI changed. Try \`bridge chrome start --provider ${commandScope.provider}\`.`;
    fail(commandScope.orchestratorError == null ? fallbackHint : commandScope.orchestratorError);
    return;
  }

  if (commandScope.options.json) {
    process.stdout.write(
      `${JSON.stringify({
        sessionId: commandScope.engine.sessionId,
        model: commandScope.engine.getOrchestrator().model,
        reply: commandScope.reply.content,
        contextTokens: commandScope.engine.counter.count,
        conversationId: commandScope.askedChat.conversationId,
        url: commandScope.askedChat.url,
      })}\n`,
    );
    return;
  }

  process.stdout.write(`${commandScope.reply.content}\n`);
};

type StartAskEngineDetails = {
  options: AskSettings;
  provider: ReturnType<typeof readProviderIdFrom>;
  supportsMcpConnector: boolean;
};

const runAskFlow = async (details: { prompt: string; options: AskSettings }): Promise<void> => {
  if (details.options.fanOut) return fanOutFromSettings(details.options);

  const isPromptBlank = !details.prompt.trim();
  if (isPromptBlank) {
    return failUsage('Provide a prompt (e.g. `bridge ask "hi"`) or a task file via --fan-out.');
  }

  const providers = listProvidersOrFail(details.options.provider);

  const hasManyProviders = providers.length > 1;
  if (hasManyProviders) {
    return fanOutPromptAcrossProviders({
      prompt: details.prompt,
      providers,
      options: details.options,
    });
  }

  const setup = await prepareAskRun(details.options);
  const captured = captureOrchestratorError(setup.engine);
  const reply = await askEngineTurn({
    engine: setup.engine,
    prompt: details.prompt,
    options: details.options,
  });
  await finishAskRun({
    setup,
    reply,
    orchestratorError: captured.lastError(),
    options: details.options,
  });
};

const listProvidersOrFail = (spec: string | undefined): BridgeProviderId[] => {
  try {
    return listProviderIdsFrom(spec);
  } catch (error) {
    const isErrorObject = error instanceof Error;
    return fail(isErrorObject ? error.message : String(error));
  }
};

const fanOutPromptAcrossProviders = async (details: {
  prompt: string;
  providers: BridgeProviderId[];
  options: AskSettings;
}): Promise<void> => {
  const tasks: FanoutTask[] = details.providers.map((provider) => ({
    prompt: details.prompt,
    provider,
  }));
  const firstProvider = details.providers[0] ?? DEFAULT_PROVIDER;

  await fanOutAndReport({
    tasks,
    provider: firstProvider,
    options: details.options,
  });
};

const fanOutFromSettings = async (settings: AskSettings): Promise<void> => {
  const isFanOutMissing = settings.fanOut == null;
  const fanOutSpec = isFanOutMissing ? "" : settings.fanOut;
  const tasks = await loadFanoutTasks(fanOutSpec);

  await fanOutAndReport({
    tasks,
    provider: readProviderIdFrom(settings.provider),
    options: settings,
  });
};

const readFanoutOrigin = async (spec: string): Promise<string> => {
  const trimmed = spec.trim();

  const isArrayNotation = trimmed.startsWith("[");
  if (isArrayNotation) return trimmed;

  const isAtMentionString = trimmed.startsWith("@");
  const path = isAtMentionString ? trimmed.slice(1) : trimmed;
  const absolute = isAbsolute(path) ? path : resolve(process.cwd(), path);
  return readFile(absolute, "utf8");
};

const loadFanoutTasks = async (spec: string): Promise<readonly FanoutTask[]> => {
  const isSpecBlank = !spec.trim();
  if (isSpecBlank) return failUsage("--fan-out needs a task file, @file, or inline JSON array.");

  const unparsed = await readFanoutOrigin(spec).catch((error: unknown) => {
    const isErrorObject = error instanceof Error;
    return fail(
      `--fan-out could not read ${spec}: ${isErrorObject ? error.message : String(error)}`,
    );
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(unparsed);
  } catch (error) {
    const isErrorObject = error instanceof Error;
    return failUsage(
      `--fan-out is not valid JSON: ${isErrorObject ? error.message : String(error)}`,
    );
  }
  try {
    return FanoutTasksSchema.parse(parsed);
  } catch (error) {
    const isInstanceError = error instanceof Error;
    return failUsage(
      `--fan-out does not match the task schema (need a non-empty array of {prompt, provider?, conversation?, label?, isolate?}): ${
        isInstanceError ? error.message : String(error)
      }`,
    );
  }
};

interface FanoutRunDetails {
  readonly tasks: readonly FanoutTask[];
  readonly provider: BridgeProviderId;
  readonly options: AskSettings;
}

const fanOutAndReport = async (details: FanoutRunDetails): Promise<void> => {
  const engine = await startAskEngine({
    options: { ...details.options, provider: details.provider },
    provider: details.provider,
    supportsMcpConnector: false,
  });

  const isFanoutFailed = await fanOutOnEngine(engine, details);
  if (isFanoutFailed) throw new Error("Some fan-out tasks failed.");
};

const fanOutOnEngine = async (
  engine: Awaited<ReturnType<typeof startAskEngine>>,
  details: FanoutRunDetails,
): Promise<boolean> => {
  try {
    const isEngineBrowserMissing = engine.browser == null;
    if (isEngineBrowserMissing) {
      return fail(
        `Browser not connected. Run \`bridge chrome start --provider ${details.provider}\` and sign in if needed.`,
      );
    }

    const fanoutReport = await fanOutConversations({
      browser: engine.browser,
      config: engine.config,
      tasks: details.tasks,
      manifestRoot: readAttachmentManifestsDirectory(),
      options: readFanoutSettingsFromAsk(details.options),
    });
    writeFanoutPrintout(fanoutReport, details.options);
    await Promise.allSettled([engine.shutDown({ closeBrowser: false })]);
    return fanoutFailed(fanoutReport, Boolean(details.options.strict));
  } catch (error) {
    await Promise.allSettled([engine.shutDown({ closeBrowser: false })]);
    const isErrorObject = error instanceof Error;
    return fail(isErrorObject ? error.message : String(error));
  }
};

const readPositiveIntegerFromOption = (flagArgument: string | undefined): number | undefined => {
  const isFlagArgumentMissing = flagArgument == null;
  if (isFlagArgumentMissing) return undefined;

  const parsed = Number.parseInt(flagArgument, 10);
  const isPositiveNumber = Number.isFinite(parsed) && parsed > 0;
  return isPositiveNumber ? parsed : undefined;
};

const readNonNegativeIntegerFromOption = (field: string | undefined): number | undefined => {
  const isOptionFieldAbsent = field == null;
  if (isOptionFieldAbsent) return undefined;

  const parsed = Number.parseInt(field, 10);
  const isNonNegativeNumber = Number.isFinite(parsed) && parsed >= 0;
  return isNonNegativeNumber ? parsed : undefined;
};

const readFanoutSettingsFromAsk = (settings: AskSettings): FanoutSettings => {
  const timeoutMs = convertSecondsToTimeoutMilliseconds(settings.timeout);
  const maxConcurrency = readPositiveIntegerFromOption(settings.maxConcurrency);
  const limit = readPositiveIntegerFromOption(settings.limit);
  const offset = readNonNegativeIntegerFromOption(settings.offset);
  const maxReplyChars = readPositiveIntegerFromOption(settings.maxReplyChars);
  const hasOffset = offset != null;

  return {
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(maxConcurrency ? { maxConcurrency } : {}),
    ...(limit ? { limit } : {}),
    ...(hasOffset ? { offset } : {}),
    ...(maxReplyChars ? { maxReplyChars } : {}),
  };
};

const writeFanoutPrintout = (report: FanoutReport, settings: AskSettings): void => {
  if (settings.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return;
  }

  report.results.forEach((targetReport, index) => {
    const status = targetReport.ok ? "ok" : "error";
    const heading = createFanoutHeading({ row: targetReport, offset: report.offset, index });
    const target = readFanoutTargetLabel(targetReport.target);
    const truncated = targetReport.truncated ? `, truncated from ${targetReport.replyChars}` : "";
    const reportFields = createFanoutFields(targetReport);

    process.stdout.write(
      `=== ${heading} (${status}, ${targetReport.elapsedMs}ms${target}${truncated}) ===\n${reportFields}\n\n`,
    );
  });

  const hasMorePages = report.nextOffset != null;
  if (hasMorePages) {
    const remaining = report.total - report.offset - report.results.length;
    process.stdout.write(
      `… ${remaining} more task(s). Re-run with --offset ${report.nextOffset}.\n`,
    );
  }
};

const createFanoutHeading = (details: {
  row: FanoutReport["results"][number];
  offset: number;
  index: number;
}): string => {
  if (details.row.label != null && details.row.label !== "") return details.row.label;

  return `task ${details.offset + details.index + 1}`;
};

const readFanoutTargetLabel = (target: FanoutReport["results"][number]["target"]): string => {
  const isTargetMissing = target == null;
  if (isTargetMissing) return "";

  if (target.id == null || target.id === "") return ` ${target.provider}`;

  return ` ${target.provider} ${target.id}`;
};

const createFanoutFields = (targetReport: FanoutReport["results"][number]): string => {
  if (targetReport.ok) {
    const hasNoReply = targetReport.reply == null;
    if (hasNoReply) return "";

    return targetReport.reply;
  }

  const hasNoError = targetReport.error == null;
  if (hasNoError) return "";

  return targetReport.error;
};

const readFanOutForServe = async (
  tasks: FanoutTask[],
  batchSettings: FanoutSettings,
  base: AskSettings,
): Promise<FanoutReport> => {
  const provider = readProviderIdFrom(base.provider);
  const engine = await startAskEngine({
    options: { ...base, provider },
    provider,
    supportsMcpConnector: false,
  });
  try {
    const isEngineBrowserMissing = engine.browser == null;
    if (isEngineBrowserMissing) {
      throw new Error(
        `Browser not connected. Run \`bridge chrome start --provider ${provider}\` first.`,
      );
    }

    return await fanOutConversations({
      browser: engine.browser,
      config: engine.config,
      tasks,
      manifestRoot: readAttachmentManifestsDirectory(),
      options: batchSettings,
    });
  } finally {
    await Promise.allSettled([engine.shutDown({ closeBrowser: false })]);
  }
};

// stdout is JSON-RPC; engine/browser logs must not write there.
export const runServe = async (settings: ServeSettings): Promise<void> => {
  const base: AskSettings = { repo: settings.repo, port: settings.port, timeout: settings.timeout };
  const collaborators: AskGatewayCollaborators = {
    repoRoot: readRepositoryRoot(settings.repo),
    fanOut: (tasks, settings) => readFanOutForServe(tasks, settings, base),
    searchConversations: (providers, query, settings) => {
      const providerIds = providers.map((provider) => readProviderIdFrom(provider));

      return readFanoutConversationSearch({
        providers: providerIds,
        query,
        options: base,
        searchOptions: settings,
      });
    },
    withFlowPage: async (op) => {
      const { engine, page } = await startFlowSession({ repo: settings.repo, port: settings.port });

      try {
        return await op(page);
      } finally {
        await Promise.allSettled([engine.shutDown({ closeBrowser: false })]);
      }
    },
    withDesignPage: (op) => runWithDesignPage({ repo: settings.repo, port: settings.port }, op),
    withChatGptPage: async (op) => {
      const { engine, page } = await startWorkspaceSession({
        repo: settings.repo,
        port: settings.port,
      });

      try {
        return await op(page);
      } finally {
        await Promise.allSettled([engine.shutDown({ closeBrowser: false })]);
      }
    },
  };
  await serveAskGatewayStdio(collaborators);
};

type ConversationSearchVerdict = {
  ok: boolean;
  results?: ConversationSearchReport[];
  error?: string;
  elapsedMs: number;
};

interface ReadFanoutConversationSearchDetails {
  providers: BridgeProviderId[];
  query: string;
  options: AskSettings;
  searchOptions?: { limit?: number };
}

const readFanoutConversationSearch = async ({
  providers,
  query,
  options: settings,
  searchOptions: searchSettings = {},
}: ReadFanoutConversationSearchDetails): Promise<Record<string, ConversationSearchVerdict>> => {
  const verdicts = await Promise.all(
    providers.map(async (provider): Promise<readonly [string, ConversationSearchVerdict]> => {
      const started = Date.now();

      try {
        const searchReports = await searchOneProvider({
          provider,
          query,
          options: settings,
          searchOptions: searchSettings,
        });
        return [provider, { ok: true, results: searchReports, elapsedMs: Date.now() - started }];
      } catch (caughtError) {
        const isErrorObject = caughtError instanceof Error;
        const error = isErrorObject ? caughtError.message : String(caughtError);
        return [provider, { ok: false, error, elapsedMs: Date.now() - started }];
      }
    }),
  );

  return Object.fromEntries(verdicts);
};

interface SearchOneProviderDetails {
  provider: BridgeProviderId;
  query: string;
  options: AskSettings;
  searchOptions: { limit?: number };
}

const searchOneProvider = async ({
  provider,
  query,
  options: settings,
  searchOptions: searchSettings,
}: SearchOneProviderDetails): Promise<ConversationSearchReport[]> => {
  const browserProvider = readProvider(provider);
  const engine = await startAskEngine({
    options: { ...settings, provider },
    provider,
    supportsMcpConnector: false,
  });
  try {
    const browser = engine.browser;

    const isBrowserMissing = browser == null;
    if (isBrowserMissing) {
      throw new Error(
        `Browser not connected. Run \`bridge chrome start --provider ${provider}\` first.`,
      );
    }

    await browserProvider.assertSignedIn(browser.getPage());
    return await engine.getOrchestrator().searchConversations({
      query,
      limit: searchSettings.limit,
    });
  } finally {
    await Promise.allSettled([engine.shutDown({ closeBrowser: false })]);
  }
};

// Capture orchestrator errors so a null reply can report the real failure.
const captureOrchestratorError = (
  engine: Awaited<ReturnType<typeof startEngine>>,
): {
  lastError: () => string | null;
} => {
  let lastError: string | null = null;

  engine.getOrchestrator().subscribe((event) => {
    const isEventTypeError = event.type === "error";
    if (isEventTypeError) lastError = event.error;
  });

  return { lastError: () => lastError };
};

const prepareAskRun = async (settings: AskSettings) => {
  const providers = pickAskProvider(settings);
  const engine = await startAskEngine({
    options: settings,
    provider: providers.provider,
    supportsMcpConnector: providers.browserProvider.supportsMcpConnector,
  });

  addStopOnInterrupt(() => stopEngine(engine));
  await assertSignedIn(engine, providers.browserProvider, providers.provider);

  return { engine, ...providers };
};

const pickAskProvider = (settings: AskSettings) => {
  const provider = readProviderIdFrom(settings.provider);
  return { provider, browserProvider: readProvider(provider) };
};

const finishAskRun = async (details: {
  setup: Awaited<ReturnType<typeof prepareAskRun>>;
  reply: Awaited<ReturnType<Awaited<ReturnType<typeof startEngine>>["ask"]>>;
  orchestratorError: string | null;
  options: AskSettings;
}): Promise<void> => {
  const askedChat = readAskedChat(details.setup);

  await details.setup.engine.shutDown({ closeBrowser: false });
  writeAskPrintout({
    engine: details.setup.engine,
    askedChat,
    reply: details.reply,
    orchestratorError: details.orchestratorError,
    options: details.options,
    provider: details.setup.provider,
    displayName: details.setup.browserProvider.displayName,
  });
};

const readAskedChat = (setup: Awaited<ReturnType<typeof prepareAskRun>>): AskedChat => {
  const url = requireBrowserPage(setup.engine).url();
  const conversationId = readConversationIdForProviderUrl({ providerId: setup.provider, url });
  return { conversationId, url };
};

const startAskEngine = async (details: StartAskEngineDetails) => {
  const withTools = Boolean(details.options.tools) && details.supportsMcpConnector;

  return startEngine({
    repoPath: details.options.repo ? resolve(details.options.repo) : undefined,
    provider: details.provider,
    mcpPort: parsePortFlag(PORT_FLAG, details.options.port),
    withBrowser: true,
    withTools,
    persist: withTools,
    debugPort: parsePortFlag(DEBUG_PORT_FLAG, details.options.debugPort),
    profileRoot: readProfileRootFromOption(details.options.profile),
  });
};

const readImageCountFromOption = (flagArgument: string | undefined): number | undefined => {
  const isFlagArgumentUnset = flagArgument == null;
  if (isFlagArgumentUnset) return undefined;

  const parsed = Number.parseInt(flagArgument, 10);
  const isPositiveNumber = Number.isFinite(parsed) && parsed > 0;
  return isPositiveNumber ? parsed : undefined;
};

const LOWEST_PORT = 1;
const HIGHEST_PORT = 65535;

const parsePortFlag = (flagName: string, portArgument: string | undefined): number | undefined => {
  const isPortMissing = portArgument == null || portArgument === "";
  if (isPortMissing) return undefined;

  const port = Number(portArgument);

  const isPortValid = /^\d+$/.test(portArgument) && port >= LOWEST_PORT && port <= HIGHEST_PORT;
  if (isPortValid) return port;

  throw new Error(`${flagName} must be a whole number from ${LOWEST_PORT} to ${HIGHEST_PORT}.`);
};

const readProfileRootFromOption = (field: string | undefined): string | undefined => {
  return field ? resolve(field) : undefined;
};

const askEngineTurn = async (details: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  prompt: string;
  options: AskSettings;
}) => {
  await applyAskPreflight({ engine: details.engine, options: details.options });
  await attachAskFiles({ engine: details.engine, options: details.options });

  return details.engine.ask({
    content: details.prompt,
    timeoutMs: convertSecondsToTimeoutMilliseconds(details.options.timeout),
    expectImages: readImageCountFromOption(details.options.images),
  });
};

const attachAskFiles = async (details: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  options: AskSettings;
}): Promise<void> => {
  // Runs even without --attach, so files left in the composer by a failed ask never ride along.
  const paths = details.options.attach ?? [];
  const repoRoot = details.engine.config.repoPath;
  const absolutePaths = paths.map((target) => {
    const rel = createRepositoryFilePath({ repoRoot, input: target });
    assertImagePath(rel);
    return resolve(repoRoot, rel);
  });

  await details.engine.getOrchestrator().attachFiles(absolutePaths);
};

const readConversationUrlFromOption = (field: string): string => {
  return readChatGptConversationUrlFromIdOrUrl(field);
};

export const readConversationIdFromOption = (field: string): string => {
  const conversationUrl = readConversationUrlFromOption(field);
  const conversationId = readChatGptConversationIdFromUrl(conversationUrl);

  const isNotChatUrl = conversationId == null;
  if (isNotChatUrl) throw new Error(`Not a ChatGPT chat id or URL: ${field}`);

  return conversationId;
};

const navigateToConversationIfNeeded = async (details: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  conversation?: string;
  page: Page;
}): Promise<void> => {
  const hasNoConversation = !details.conversation;
  if (hasNoConversation) return;

  const targetUrl = readConversationUrlFromOption(details.conversation);
  if (isSameChatGptConversation(details.page.url(), targetUrl)) return;

  await Promise.allSettled([details.engine.getOrchestrator().navigateToConversation(targetUrl)]);
};

export const applyAskPreflight = async (details: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  options: AskSettings;
}): Promise<void> => {
  if (details.options.fresh)
    await Promise.allSettled([details.engine.getOrchestrator().openNewConversation()]);
  else if (details.options.conversation) {
    await Promise.allSettled([
      details.engine
        .getOrchestrator()
        .navigateToConversation(readConversationUrlFromOption(details.options.conversation)),
    ]);
  }

  const isModelEmpty = !details.options.model;
  if (isModelEmpty) return;

  try {
    await details.engine.getOrchestrator().switchModel(details.options.model);
  } catch (error) {
    const isErrorObject = error instanceof Error;
    const reason = isErrorObject ? error.message : String(error);
    throw new Error(`Could not switch to model "${details.options.model}": ${reason}`);
  }
};

const assertDownloadProviderSupported = (settings: DownloadCommandSettings): void => {
  const isGeminiProvider = readProviderIdFrom(settings.provider) === "gemini";
  if (isGeminiProvider) {
    fail("Attachment download is not supported for Gemini web yet. Use ChatGPT for /download.");
  }
};

const downloadConversationAttachments = async (details: {
  page: Page;
  conversationId: string;
  repoRoot: string;
  options: DownloadCommandSettings;
  manifestRoot: string;
}): Promise<DownloadReport[]> => {
  const ids = parseAttachmentIds(details.options.id);

  return downloadAll(details.page, details.conversationId, {
    repoRoot: details.repoRoot,
    manifestRoot: details.manifestRoot,
    ...(details.options.out ? { outDir: details.options.out } : {}),
    ...(ids ? { ids } : {}),
  });
};

const writeDownloadPrintout = (reports: DownloadReport[], document?: boolean): void => {
  if (document) {
    process.stdout.write(`${JSON.stringify(reports)}\n`);
    return;
  }

  for (const download of reports) {
    const line = `${createDownloadLine(download)}
`;

    if (download.error) process.stderr.write(line);
    else process.stdout.write(line);
  }
};

export const parseAttachmentIds = (fields: readonly string[] | undefined): string[] | null => {
  const hasNoFields = !fields;
  if (hasNoFields) return null;

  const ids = fields
    .flatMap((field) => field.split(/[\s,]+/))
    .map((id) => id.trim())
    .filter(Boolean);
  const isIdsNotEmpty = ids.length > 0;
  return isIdsNotEmpty ? ids : null;
};

export const createDownloadLine = (report: DownloadReport): string => {
  const isIdBlank = report.id == null || report.id === "";
  const label = isIdBlank ? "attachment" : report.id;

  const hasError = report.error != null;
  if (hasError) return `${label}: ${report.error}`;

  return `${label} -> ${report.path} (${report.bytes} bytes)`;
};

export const runDownload = async (settings: DownloadCommandSettings): Promise<void> => {
  assertDownloadProviderSupported(settings);
  const reports = await runDownloadFlow(settings);
  writeDownloadPrintout(reports, settings.json);
};

const runDownloadFlow = async (settings: DownloadCommandSettings): Promise<DownloadReport[]> => {
  const scope = await prepareDownloadScope(settings);
  const reports = await downloadAfterExtract(scope);
  await scope.engine.shutDown({ closeBrowser: false });
  return reports;
};

const prepareDownloadScope = async (settings: DownloadCommandSettings) => {
  const engine = await startDownloadEngine(settings);
  const page = requireBrowserPage(engine);

  return {
    engine,
    page,
    conversationId: downloadConversationId({ page, conversation: settings.conversation }),
    options: settings,
  };
};

const downloadConversationId = (details: {
  page: Page;
  conversation: string | undefined;
}): string => {
  const { page, conversation } = details;

  const isNotConversationGiven = conversation == null;
  if (isNotConversationGiven) return readConversationIdFromPage(page);

  return readConversationIdFromOption(conversation);
};

const downloadAfterExtract = async (details: {
  page: Page;
  conversationId: string;
  options: DownloadCommandSettings;
  engine: Awaited<ReturnType<typeof startDownloadEngine>>;
}): Promise<DownloadReport[]> => {
  const manifestRoot = readAttachmentManifestsDirectory();
  await navigateToConversationIfNeeded({
    engine: details.engine,
    conversation: details.options.conversation,
    page: details.page,
  });
  await extractAllMessages(details.page, { conversationId: details.conversationId, manifestRoot });
  await registerConversationImages({
    page: details.page,
    conversationId: details.conversationId,
    manifestRoot,
  });

  if (details.options.scan) {
    const manifest = await loadManifest(details.conversationId, { manifestRoot });
    process.stderr.write(
      `Manifest refreshed: ${manifest.attachments.length} attachment(s) for ${details.conversationId}\n`,
    );
    return [];
  }

  return downloadConversationAttachments({
    ...details,
    repoRoot: details.engine.config.repoPath,
    manifestRoot,
  });
};

const startDownloadEngine = async (settings: DownloadCommandSettings) => {
  return startEngine({
    repoPath: settings.repo ? resolve(settings.repo) : undefined,
    provider: readProviderIdFrom(settings.provider),
    mcpPort: parsePortFlag(PORT_FLAG, settings.port),
    withBrowser: true,
    withTools: false,
    persist: false,
    debugPort: parsePortFlag(DEBUG_PORT_FLAG, settings.debugPort),
    profileRoot: readProfileRootFromOption(settings.profile),
  });
};

const requireBrowserPage = (engine: Awaited<ReturnType<typeof startEngine>>): Page => {
  const browser = engine.browser;

  const isBrowserMissing = browser == null;
  if (isBrowserMissing) {
    void engine.shutDown({ closeBrowser: false });
    return fail(
      "Browser not connected. Run `bridge chrome start` and sign in to ChatGPT if needed.",
    );
  }

  return browser.getPage();
};

const assertChatgptWorkspace = (settings: CliSettings): void => {
  const isNotChatGptProvider = readProviderIdFrom(settings.provider) !== CHATGPT_PROVIDER_ID;
  if (isNotChatGptProvider) {
    fail(
      "Projects, chat moves, and Scheduled tasks are ChatGPT-only. Omit --provider or pass --provider chatgpt.",
    );
  }
};

const startWorkspaceSession = async (settings: CliSettings & BrowserTargetSettings) => {
  const engine = await startEngine({
    repoPath: settings.repo ? resolve(settings.repo) : undefined,
    provider: CHATGPT_PROVIDER_ID,
    mcpPort: parsePortFlag(PORT_FLAG, settings.port),
    withBrowser: true,
    withTools: false,
    debugPort: parsePortFlag(DEBUG_PORT_FLAG, settings.debugPort),
    profileRoot: readProfileRootFromOption(settings.profile),
  });

  return { engine, page: requireBrowserPage(engine) };
};

export const runProjectList = async (settings: ProjectCommandSettings): Promise<void> => {
  assertChatgptWorkspace(settings);
  const { engine, page } = await startWorkspaceSession(settings);
  const projects = await listProjects(page);
  await engine.shutDown({ closeBrowser: false });

  if (settings.json) process.stdout.write(`${JSON.stringify(projects)}\n`);
  else if (projects.length === 0) process.stdout.write("No projects.\n");
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

export const runChatList = async (settings: ChatCommandSettings): Promise<void> => {
  assertChatgptWorkspace(settings);
  const { engine } = await startWorkspaceSession(settings);
  const chats = await engine
    .getOrchestrator()
    .listConversations({ orphans: Boolean(settings.orphans) });
  await engine.shutDown({ closeBrowser: false });
  let printout = "";

  if (settings.json) printout = `${JSON.stringify(chats)}\n`;
  else if (chats.length === 0) printout = "No conversations.\n";
  else printout = `${chats.map((chat) => `${chat.id}\t${chat.title}`).join(NEWLINE)}\n`;

  await new Promise<void>((finish, reject) => {
    process.stdout.write(printout, (error) => {
      if (error) reject(error);
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
    const isErrorObject = error instanceof Error;
    return fail(isErrorObject ? error.message : String(error));
  }
  await openSearchHitIfFound({ engine, results: reports, open: Boolean(settings.open) });
  await engine.shutDown({ closeBrowser: false });
  writeChatSearchPrintout(reports, settings);

  const isThereNoSearchHit = reports.length === 0;
  if (isThereNoSearchHit) throw new Error(`No conversation matches "${query}".`);
};

const readLimitFromOption = (field: string | undefined): number | null => {
  const hasNoField = !field;
  if (hasNoField) return null;

  const parsed = Number.parseInt(field, 10);
  const isPositiveNumber = Number.isFinite(parsed) && parsed > 0;
  return isPositiveNumber ? parsed : null;
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
  if (settings.json) {
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
  if (single) return [single];

  return [];
};

const writeMoveReports = (moveReports: MoveChatVerdict[], settings: ChatCommandSettings): void => {
  if (settings.json) {
    process.stdout.write(`${JSON.stringify(moveReports)}\n`);
    return;
  }

  for (const verdict of moveReports) {
    if (verdict.moved) process.stdout.write(`Moved "${verdict.chat}" -> ${verdict.project}\n`);
    else if (verdict.alreadyFiled) {
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
  if (settings.json) {
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

const DEFAULT_ORGANIZATION_INTERVAL_SECONDS = 60;
const DEFAULT_ORGANIZATION_MIN_INTERVAL_SECONDS = 15;
const DEFAULT_ORGANIZATION_MAX_INTERVAL_SECONDS = 180;
const DEFAULT_ORGANIZATION_SPEED_UP_AFTER = 3;
const DEFAULT_ORGANIZATION_COOLDOWN_SECONDS = 600;
const DEFAULT_ORGANIZATION_MAX_ATTEMPTS = 4;
const MAX_CONSECUTIVE_ORGANIZATION_COOLDOWNS = 12;

const readPositiveIntegerOption = (
  flagArgument: string | undefined,
  optionName: string,
  defaultField: number,
): number => {
  const isFlagArgumentUnset = flagArgument == null;
  if (isFlagArgumentUnset) return defaultField;

  const isNotPositiveInteger = !/^[1-9]\d*$/u.test(flagArgument.trim());
  if (isNotPositiveInteger) {
    return failUsage(`${optionName} must be a positive whole number.`);
  }

  const parsed = Number.parseInt(flagArgument, 10);
  return parsed;
};

const readOrganizationIntervalOption = (field: string | undefined): ChatOrganizationInterval => {
  try {
    return readChatOrganizationInterval(field, DEFAULT_ORGANIZATION_INTERVAL_SECONDS);
  } catch (error) {
    const isErrorObject = error instanceof Error;
    return fail(isErrorObject ? error.message : String(error));
  }
};

const waitForOrganizationInterval = async (
  seconds: number,
  queuePath: string,
): Promise<"elapsed" | "paused"> => {
  let remainingMilliseconds = seconds * 1_000;
  while (remainingMilliseconds > 0) {
    const isQueuePaused = await isChatOrganizationQueuePaused(queuePath);
    if (isQueuePaused) return "paused";

    const slice = Math.min(1_000, remainingMilliseconds);
    await new Promise<void>((complete) => setTimeout(complete, slice));
    remainingMilliseconds -= slice;
  }

  const isQueuePausedNow = await isChatOrganizationQueuePaused(queuePath);
  if (isQueuePausedNow) return "paused";

  return "elapsed";
};

const writeChatOrganizationProgress = (
  message: string,
  settings: ChatOrganizationSettings,
): void => {
  if (settings.json) {
    process.stderr.write(`${message}\n`);
    return;
  }

  process.stdout.write(`${message}\n`);
};

const moveFailureReason = (verdict: MoveChatVerdict): string => {
  if (verdict.reason?.trim()) return verdict.reason;

  return "ChatGPT did not confirm the Conversation move.";
};

const writeChatOrganizationSummary = (details: {
  queuePath: string;
  queue: ChatOrganizationQueue;
  options: ChatOrganizationSettings;
  paused?: boolean;
}): void => {
  const summary = summarizeChatOrganizationQueue(details.queue);

  if (details.options.json) {
    process.stdout.write(
      `${JSON.stringify({
        queuePath: details.queuePath,
        state: details.paused ? "paused" : "finished",
        summary,
        pacing: details.queue.pacing,
        verification: details.queue.verification,
      })}\n`,
    );
    return;
  }

  const isQueuePacingMissing = details.queue.pacing == null;
  const isQueueVerificationMissing = details.queue.verification == null;
  process.stdout.write(
    `${[
      details.paused ? QUEUE_PAUSED_MESSAGE : "Organization queue finished.",
      `Moved: ${summary.moved}`,
      `Already filed: ${summary.alreadyFiled}`,
      `Pending: ${summary.pending}`,
      `Failed: ${summary.failed}`,
      isQueuePacingMissing
        ? undefined
        : `Adaptive pace: ${details.queue.pacing.currentSeconds}s base (${details.queue.pacing.rateLimitCount} rate limits)`,
      isQueueVerificationMissing
        ? undefined
        : `Full-history verification: ${details.queue.verification.complete ? "complete" : "incomplete"}; ${details.queue.verification.remainingOrphans} intentional/remaining orphans`,
      `Queue state: ${details.queuePath}`,
    ]
      .filter((line) => line != null)
      .join(NEWLINE)}\n`,
  );
};

const writeChatOrganizationDryRun = (details: {
  tasks: Awaited<ReturnType<typeof loadChatOrganizationTasks>>;
  queuePath: string;
  interval: ChatOrganizationInterval;
  cooldownSeconds: number;
  maxAttempts: number;
  adaptive: boolean;
  minimumIntervalSeconds: number;
  maximumIntervalSeconds: number;
  speedUpAfter: number;
  options: ChatOrganizationSettings;
}): void => {
  const preview = {
    dryRun: true,
    queuePath: details.queuePath,
    interval: details.interval,
    cooldownSeconds: details.cooldownSeconds,
    maxAttempts: details.maxAttempts,
    adaptive: details.adaptive,
    minimumIntervalSeconds: details.minimumIntervalSeconds,
    maximumIntervalSeconds: details.maximumIntervalSeconds,
    speedUpAfter: details.speedUpAfter,
    tasks: details.tasks,
  };

  if (details.options.json) {
    process.stdout.write(`${JSON.stringify(preview)}\n`);
    return;
  }

  process.stdout.write(
    `${[
      `Organization queue dry run: ${details.tasks.length} Conversations`,
      `Interval: ${readChatOrganizationIntervalLabel(details.interval)}`,
      `Adaptive pacing: ${details.adaptive ? `yes (${details.minimumIntervalSeconds}-${details.maximumIntervalSeconds}s; speed up after ${details.speedUpAfter} successes)` : "no"}`,
      `Rate-limit cooldown: ${details.cooldownSeconds}s`,
      `Attempts per Conversation: ${details.maxAttempts}`,
      `Resume state: ${details.queuePath}`,
      ...details.tasks.map((task) => `  ${task.conversation} -> ${task.project}`),
    ].join(NEWLINE)}\n`,
  );
};

const saveChatOrganizationAttempt = async (details: {
  queue: ChatOrganizationQueue;
  queuePath: string;
  index: number;
  maxAttempts: number;
  sessionClosed: boolean;
  rateLimited: boolean;
  moveOutcome?: MoveChatVerdict;
  thrownReason?: string;
}): Promise<ChatOrganizationQueue> => {
  const timestamp = new Date().toISOString();
  let queue: ChatOrganizationQueue;

  if (details.sessionClosed) {
    queue = deferChatOrganizationQueueElement({
      queue: details.queue,
      index: details.index,
      reason: "ChatGPT browser session closed; reopening before retry.",
      timestamp,
    });
  } else if (details.rateLimited) {
    queue = deferChatOrganizationQueueElement({
      queue: details.queue,
      index: details.index,
      reason: "ChatGPT temporarily limited access to Conversation history.",
      timestamp,
    });
  } else if (details.moveOutcome?.moved) {
    queue = completeChatOrganizationQueueElement({
      queue: details.queue,
      index: details.index,
      status: MOVED_STATUS,
      timestamp,
    });
  } else if (details.moveOutcome?.alreadyFiled) {
    queue = completeChatOrganizationQueueElement({
      queue: details.queue,
      index: details.index,
      status: ALREADY_FILED_STATUS,
      timestamp,
    });
  } else {
    let reason = "ChatGPT did not complete the Conversation move.";

    if (details.moveOutcome != null) reason = moveFailureReason(details.moveOutcome);
    else if (details.thrownReason != null) reason = details.thrownReason;

    queue = failChatOrganizationQueueElement({
      queue: details.queue,
      index: details.index,
      reason,
      maxAttempts: details.maxAttempts,
      timestamp,
    });
  }

  await persistChatOrganizationQueue(details.queuePath, queue);
  return queue;
};

const persistChatOrganizationPacing = async (details: {
  queue: ChatOrganizationQueue;
  queuePath: string;
  pacing: ChatOrganizationPacing;
}): Promise<ChatOrganizationQueue> => {
  const queue = updateChatOrganizationQueuePacing({
    queue: details.queue,
    pacing: details.pacing,
    timestamp: new Date().toISOString(),
  });

  await persistChatOrganizationQueue(details.queuePath, queue);

  return queue;
};

const verifyCompletedChatOrganizationQueue = async (details: {
  queue: ChatOrganizationQueue;
  queuePath: string;
  workspace: Awaited<ReturnType<typeof startWorkspaceSession>>;
  options: ChatOrganizationSettings;
  maxAttempts: number;
}): Promise<ChatOrganizationQueue> => {
  writeChatOrganizationProgress(
    "Verifying the completed plan against an exhaustive full-history orphan scan.",
    details.options,
  );
  const timestamp = new Date().toISOString();
  let verification: NonNullable<ChatOrganizationQueue["verification"]>;
  try {
    const orphans = await details.workspace.engine
      .getOrchestrator()
      .listConversations({ orphans: true });
    verification = verifyChatOrganizationQueue({
      queue: details.queue,
      orphans,
      timestamp,
    });
  } catch (error) {
    const isErrorObject = error instanceof Error;
    verification = {
      complete: false,
      inventoryComplete: false,
      remainingOrphans: 0,
      plannedStillLoose: [],
      verifiedAt: timestamp,
      error: isErrorObject ? error.message : String(error),
    };
  }
  let queue = updateChatOrganizationQueueVerification({
    queue: details.queue,
    verification,
    timestamp,
  });

  const hasVerificationPlannedStillLoose = verification.plannedStillLoose.length > 0;
  if (hasVerificationPlannedStillLoose) {
    queue = reopenChatOrganizationQueueElements({
      queue,
      conversations: verification.plannedStillLoose,
      maxAttempts: details.maxAttempts,
      timestamp,
    });
  }

  await persistChatOrganizationQueue(details.queuePath, queue);

  if (verification.inventoryComplete) {
    writeChatOrganizationProgress(
      `Full-history scan reached the stable end: ${verification.remainingOrphans} loose Conversations remain; ${verification.plannedStillLoose.length} planned Conversations are still loose.`,
      details.options,
    );
  } else {
    writeChatOrganizationProgress(
      `Full-history verification could not prove completion: ${verification.error ?? "unknown scan failure"}`,
      details.options,
    );
  }

  return queue;
};

const readOrganizationQueueStatus = (details: {
  paused: boolean;
  running: boolean;
  summary: ReturnType<typeof summarizeChatOrganizationQueue>;
}): "running" | "pausing" | "paused" | "idle" | "completed" | "failed" => {
  if (details.running) return details.paused ? "pausing" : "running";

  if (details.paused) return "paused";

  const isNothingPending = details.summary.pending === 0;
  const hasFailedElements = details.summary.failed > 0;

  if (isNothingPending) return hasFailedElements ? FAILED_STATUS : "completed";

  return "idle";
};

export const runChatOrganizeStatus = async (settings: ChatOrganizationSettings): Promise<void> => {
  const selected = await findChatOrganizationQueue(
    readRepositoryRoot(settings.repo),
    settings.queue,
  );
  const summary = summarizeChatOrganizationQueue(selected.queue);
  const queueStatus = readOrganizationQueueStatus({
    paused: selected.paused,
    running: selected.running,
    summary,
  });
  const status = {
    state: queueStatus,
    queuePath: selected.path,
    ownerPid: selected.ownerPid,
    summary,
    pacing: selected.queue.pacing,
    verification: selected.queue.verification,
  };

  if (settings.json) process.stdout.write(`${JSON.stringify(status)}\n`);
  else {
    const isQueuePacingMissing = selected.queue.pacing == null;
    const isQueueVerificationMissing = selected.queue.verification == null;
    process.stdout.write(
      `${[
        `Organization queue: ${queueStatus}`,
        `Moved: ${summary.moved}`,
        `Already filed: ${summary.alreadyFiled}`,
        `Pending: ${summary.pending}`,
        `Failed: ${summary.failed}`,
        isQueuePacingMissing
          ? "Adaptive pace: not initialized"
          : `Adaptive pace: ${selected.queue.pacing.currentSeconds}s base (${selected.queue.pacing.successStreak} success streak; ${selected.queue.pacing.rateLimitCount} rate limits)`,
        isQueueVerificationMissing
          ? "Full-history verification: not run"
          : `Full-history verification: ${selected.queue.verification.complete ? "complete" : "incomplete"}`,
        `Queue state: ${selected.path}`,
      ].join(NEWLINE)}\n`,
    );
  }
};

export const runChatOrganizePause = async (settings: ChatOrganizationSettings): Promise<void> => {
  const selected = await findChatOrganizationQueue(
    readRepositoryRoot(settings.repo),
    settings.queue,
  );
  await pauseChatOrganizationQueue(selected.path, new Date().toISOString());
  const message = selected.running
    ? "Pause requested; the active UI operation will finish before the queue releases its lock."
    : QUEUE_PAUSED_MESSAGE;

  if (settings.json) {
    process.stdout.write(
      `${JSON.stringify({ state: selected.running ? "pausing" : "paused", queuePath: selected.path })}\n`,
    );
  } else process.stdout.write(`${message}\nQueue state: ${selected.path}\n`);
};

export const runChatOrganizeResume = async (settings: ChatOrganizationSettings): Promise<void> => {
  assertChatgptWorkspace(settings);

  const selected = await findChatOrganizationQueue(
    readRepositoryRoot(settings.repo),
    settings.queue,
  );
  if (selected.running) return fail(`Organization queue is already running: ${selected.path}`);

  await clearChatOrganizationQueuePause(selected.path);
  const plan = JSON.stringify(
    selected.queue.items.map((element) => ({
      conversation: element.conversation,
      project: element.project,
    })),
  );
  return runChatOrganize({ ...settings, plan, restart: false, dryRun: false });
};

const listPlannedProjectNames = (tasks: readonly { readonly project: string }[]): string[] => {
  return tasks.map((task) => task.project);
};

const checkPlannedProjectsExist = async (
  settings: ChatOrganizationSettings,
  projectNames: string[],
): Promise<void> => {
  const { engine, page } = await startWorkspaceSession(settings);

  try {
    await readProjectIds(page, projectNames);
  } finally {
    await engine.shutDown({ closeBrowser: false });
  }
};

export const runChatOrganize = async (settings: ChatOrganizationSettings): Promise<void> => {
  assertChatgptWorkspace(settings);

  const plan = settings.plan;

  const isPlanMissing = plan == null || !plan.trim();
  if (isPlanMissing) {
    return failUsage("Usage: bridge chat organize --plan <fileOrJson>");
  }

  const interval = readOrganizationIntervalOption(settings.interval);
  const adaptive = settings.adaptive !== false;
  const minimumIntervalSeconds = readPositiveIntegerOption(
    settings.minInterval,
    "--min-interval",
    DEFAULT_ORGANIZATION_MIN_INTERVAL_SECONDS,
  );

  const maximumIntervalSeconds = readPositiveIntegerOption(
    settings.maxInterval,
    "--max-interval",
    DEFAULT_ORGANIZATION_MAX_INTERVAL_SECONDS,
  );

  const isIntervalInverted = maximumIntervalSeconds < minimumIntervalSeconds;
  if (isIntervalInverted) {
    return failUsage("--max-interval must be greater than or equal to --min-interval.");
  }

  const speedUpAfter = readPositiveIntegerOption(
    settings.speedUpAfter,
    "--speed-up-after",
    DEFAULT_ORGANIZATION_SPEED_UP_AFTER,
  );
  const cooldownSeconds = readPositiveIntegerOption(
    settings.cooldown,
    "--cooldown",
    DEFAULT_ORGANIZATION_COOLDOWN_SECONDS,
  );
  const maxAttempts = readPositiveIntegerOption(
    settings.maxAttempts,
    "--max-attempts",
    DEFAULT_ORGANIZATION_MAX_ATTEMPTS,
  );
  let tasks: Awaited<ReturnType<typeof loadChatOrganizationTasks>>;
  try {
    tasks = await loadChatOrganizationTasks(plan, process.cwd());
  } catch (error) {
    const isErrorObject = error instanceof Error;
    return fail(isErrorObject ? error.message : String(error));
  }
  const repoRoot = readRepositoryRoot(settings.repo);
  const queuePath = readChatOrganizationQueuePath(repoRoot, tasks);

  if (settings.dryRun) {
    await checkPlannedProjectsExist(settings, listPlannedProjectNames(tasks));
    writeChatOrganizationDryRun({
      tasks,
      queuePath,
      interval,
      cooldownSeconds,
      maxAttempts,
      adaptive,
      minimumIntervalSeconds,
      maximumIntervalSeconds,
      speedUpAfter,
      options: settings,
    });
    return;
  }

  let releaseQueueLock: () => Promise<void>;
  try {
    releaseQueueLock = await acquireChatOrganizationQueueLock(queuePath);
  } catch (error) {
    const isErrorInstanceError = error instanceof Error;
    return fail(isErrorInstanceError ? error.message : String(error));
  }
  let queue: ChatOrganizationQueue;
  try {
    const opened = await openChatOrganizationQueue({
      repoRoot,
      tasks,
      restart: Boolean(settings.restart),
      timestamp: new Date().toISOString(),
    });
    queue = opened.queue;

    if (adaptive) {
      const pacing =
        queue.pacing == null
          ? createInitialChatOrganizationPacing(
              Math.min(
                maximumIntervalSeconds,
                Math.max(
                  minimumIntervalSeconds,
                  pickNextChatOrganizationIntervalSeconds(interval, Math.random()),
                ),
              ),
            )
          : clampChatOrganizationPacing(queue.pacing, {
              minimumSeconds: minimumIntervalSeconds,
              maximumSeconds: maximumIntervalSeconds,
              speedUpAfter,
            });
      queue = await persistChatOrganizationPacing({
        queue,
        queuePath,
        pacing,
      });
    }
  } catch (error) {
    await releaseQueueLock();
    const isThrownError = error instanceof Error;
    return fail(
      `Could not open the organization queue: ${isThrownError ? error.message : String(error)}`,
    );
  }
  const initialSummary = summarizeChatOrganizationQueue(queue);
  writeChatOrganizationProgress(
    `Organization queue: ${initialSummary.pending} pending of ${initialSummary.total}; state ${queuePath}`,
    settings,
  );

  const needsVerification = settings.verify !== false && queue.verification?.complete !== true;

  const isQueueDrainedWithoutVerification = initialSummary.pending === 0 && !needsVerification;
  if (isQueueDrainedWithoutVerification) {
    writeChatOrganizationSummary({ queuePath, queue, options: settings });
    await releaseQueueLock();

    const isOrganizationUnfinished =
      initialSummary.failed > 0 ||
      (settings.verify !== false && queue.verification?.complete !== true);
    if (isOrganizationUnfinished) {
      throw new Error("Chat organization has failed or unverified conversations.");
    }

    return;
  }

  let workspace: Awaited<ReturnType<typeof startWorkspaceSession>>;
  try {
    workspace = await startWorkspaceSession(settings);
  } catch (error) {
    await releaseQueueLock();
    throw error;
  }
  let workspaceWasShutdown = false;
  let paused = false;
  try {
    const projectIdByName = await readProjectIds(workspace.page, listPlannedProjectNames(tasks));
    let consecutiveRateLimitCooldowns = 0;
    let halted = false;
    while (!paused && !halted) {
      let index = findNextChatOrganizationQueueIndex(queue);
      while (index != null) {
        const isQueuePaused = await isChatOrganizationQueuePaused(queuePath);
        if (isQueuePaused) {
          paused = true;
          writeChatOrganizationProgress(
            "Organization queue pause acknowledged; no new UI operation will start.",
            settings,
          );
          break;
        }

        const element = queue.items[index];

        const isTaskNotPending = element == null || element.status !== PENDING_STATUS;
        if (isTaskNotPending) {
          index = findNextChatOrganizationQueueIndex(queue);
          continue;
        }

        const hasAcknowledgedRateLimit = await dismissChatGptHistoryRateLimit(workspace.page);
        if (hasAcknowledgedRateLimit) {
          consecutiveRateLimitCooldowns += 1;

          const isAdaptivePacingOn = adaptive && queue.pacing != null;
          if (isAdaptivePacingOn) {
            queue = await persistChatOrganizationPacing({
              queue,
              queuePath,
              pacing: slowDownPacingAfterRateLimit(queue.pacing, {
                maximumSeconds: maximumIntervalSeconds,
              }),
            });
          }

          const isCooldownLimitReached =
            consecutiveRateLimitCooldowns >= MAX_CONSECUTIVE_ORGANIZATION_COOLDOWNS;
          if (isCooldownLimitReached) {
            writeChatOrganizationProgress(
              `ChatGPT remained rate-limited after ${consecutiveRateLimitCooldowns} cooldowns; leaving the queue pending for a later resume.`,
              settings,
            );
            halted = true;
            break;
          }

          const isQueuePacingMissing = queue.pacing == null;
          writeChatOrganizationProgress(
            `ChatGPT rate limit detected; cooling down for ${cooldownSeconds}s before continuing${isQueuePacingMissing ? "." : ` at a slower ${queue.pacing.currentSeconds}s adaptive pace.`}`,
            settings,
          );

          const isWaitPaused =
            (await waitForOrganizationInterval(cooldownSeconds, queuePath)) === "paused";
          if (isWaitPaused) {
            paused = true;
            break;
          }

          continue;
        }

        consecutiveRateLimitCooldowns = 0;
        writeChatOrganizationProgress(
          `Moving "${element.conversation}" -> ${element.project} (attempt ${element.attempts + 1}/${maxAttempts})`,
          settings,
        );
        let moveVerdict: MoveChatVerdict | undefined;
        let thrownReason: string | undefined;
        try {
          moveVerdict = await moveChatToProject(workspace.page, {
            chat: element.conversation,
            project: element.project,
            projectId: readProjectIdNamed(projectIdByName, element.project),
          });
        } catch (error) {
          thrownReason = error instanceof Error ? error.message : String(error);
        }
        const sessionClosed = isChatOrganizationSessionClosed(thrownReason);
        const isRateLimitedOnPage = await dismissChatGptHistoryRateLimit(workspace.page);
        const isRateLimitedByMove = moveVerdict?.rateLimited === true;
        const rateLimited = isRateLimitedOnPage || isRateLimitedByMove;
        queue = await saveChatOrganizationAttempt({
          queue,
          queuePath,
          index,
          maxAttempts,
          sessionClosed,
          rateLimited,
          moveOutcome: moveVerdict,
          thrownReason,
        });

        const hasAdaptivePacing = adaptive && queue.pacing != null;
        if (hasAdaptivePacing) {
          let pacing = queue.pacing;

          if (rateLimited) {
            pacing = slowDownPacingAfterRateLimit(pacing, {
              maximumSeconds: maximumIntervalSeconds,
            });
          } else if (moveVerdict?.moved || moveVerdict?.alreadyFiled) {
            pacing = speedUpPacingAfterSuccess(pacing, {
              minimumSeconds: minimumIntervalSeconds,
              speedUpAfter,
            });
          } else if (pacing.successStreak > 0) {
            pacing = { ...pacing, successStreak: 0 };
          }

          queue = await persistChatOrganizationPacing({ queue, queuePath, pacing });
        }

        if (sessionClosed) {
          writeChatOrganizationProgress(
            "ChatGPT browser session closed; reopening it without consuming a retry attempt.",
            settings,
          );
          await workspace.engine.shutDown({ closeBrowser: false });
          workspaceWasShutdown = true;
          try {
            workspace = await startWorkspaceSession(settings);
            workspaceWasShutdown = false;
          } catch (error) {
            writeChatOrganizationProgress(
              `Could not reopen the ChatGPT browser session; leaving the queue pending: ${
                error instanceof Error ? error.message : String(error)
              }`,
              settings,
            );
            halted = true;
            break;
          }
          index = findNextChatOrganizationQueueIndex(queue);
          continue;
        }

        const recorded = queue.items[index];

        const isRecordedStatusMoved = recorded?.status === MOVED_STATUS;
        const isRecordedStatusAlreadyFiled = recorded?.status === ALREADY_FILED_STATUS;
        const isRecordedStatusFailed = recorded?.status === FAILED_STATUS;
        const isRecordedStatusPending = recorded?.status === PENDING_STATUS;
        if (isRecordedStatusMoved) {
          writeChatOrganizationProgress(`Moved "${recorded.conversation}".`, settings);
        } else if (isRecordedStatusAlreadyFiled) {
          writeChatOrganizationProgress(`Already filed "${recorded.conversation}".`, settings);
        } else if (isRecordedStatusFailed) {
          writeChatOrganizationProgress(
            `Failed "${recorded.conversation}" after ${recorded.attempts} attempts: ${recorded.reason}`,
            settings,
          );
        } else if (isRecordedStatusPending) {
          let reason = "unknown failure";

          const hasRecordedLastReason = recorded.lastReason != null;
          if (hasRecordedLastReason) reason = recorded.lastReason;

          writeChatOrganizationProgress(
            `Will retry "${recorded.conversation}": ${reason}`,
            settings,
          );
        }

        const isAdaptiveWithQueuePacing = adaptive && queue.pacing != null;
        let waitSeconds = isAdaptiveWithQueuePacing
          ? pickNextAdaptiveChatOrganizationIntervalSeconds(queue.pacing, Math.random())
          : pickNextChatOrganizationIntervalSeconds(interval, Math.random());

        if (rateLimited) {
          consecutiveRateLimitCooldowns += 1;
          waitSeconds = cooldownSeconds;
        }

        index = findNextChatOrganizationQueueIndex(queue);

        const hasIndex = index != null;
        if (hasIndex) {
          writeChatOrganizationProgress(
            `Waiting ${waitSeconds}s before the next UI operation${adaptive ? " (adaptive)." : "."}`,
            settings,
          );

          const isIntervalWaitPaused =
            (await waitForOrganizationInterval(waitSeconds, queuePath)) === "paused";
          if (isIntervalWaitPaused) {
            paused = true;
            break;
          }
        }
      }

      const isRunSuspended = paused || halted;
      if (isRunSuspended) break;

      const isQueueVerified =
        settings.verify !== false && summarizeChatOrganizationQueue(queue).pending === 0;
      if (isQueueVerified) {
        queue = await verifyCompletedChatOrganizationQueue({
          queue,
          queuePath,
          workspace,
          options: settings,
          maxAttempts,
        });
      }

      const reopened = findNextChatOrganizationQueueIndex(queue);

      const isReopenedMissing = reopened == null;
      if (isReopenedMissing) break;

      writeChatOrganizationProgress(
        "The full-history audit found planned Conversations still loose; retrying them automatically.",
        settings,
      );
      consecutiveRateLimitCooldowns = 0;
    }
  } finally {
    try {
      const isWorkspaceNotShutdown = !workspaceWasShutdown;
      if (isWorkspaceNotShutdown) await workspace.engine.shutDown({ closeBrowser: false });
    } finally {
      await releaseQueueLock();
    }
  }
  const summary = summarizeChatOrganizationQueue(queue);
  writeChatOrganizationSummary({ queuePath, queue, options: settings, paused });

  if (paused) return;

  const isOrganizationIncomplete =
    summary.failed > 0 ||
    summary.pending > 0 ||
    (settings.verify !== false && queue.verification?.complete !== true);
  if (isOrganizationIncomplete) {
    throw new Error("Chat organization has pending, failed or unverified conversations.");
  }
};

const writeArchiveReports = (
  archiveReports: ArchiveChatVerdict[],
  settings: ChatCommandSettings,
): void => {
  if (settings.json) {
    process.stdout.write(`${JSON.stringify(archiveReports)}\n`);
    return;
  }

  for (const verdict of archiveReports) {
    if (verdict.archived) process.stdout.write(`Archived "${verdict.chat}"\n`);
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

export const runTaskList = async (settings: TaskCommandSettings): Promise<void> => {
  assertChatgptWorkspace(settings);
  const { engine, page } = await startWorkspaceSession(settings);
  const tasks = await listTasks(page);
  await engine.shutDown({ closeBrowser: false });

  if (settings.json) process.stdout.write(`${JSON.stringify(tasks)}\n`);
  else if (tasks.length === 0) process.stdout.write("No scheduled tasks.\n");
  else
    for (const task of tasks)
      process.stdout.write(`${task.title}${task.schedule ? `\t${task.schedule}` : ""}\n`);
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

  if (settings.json) {
    const isReplyMissing = reply == null;
    const replyMessage = isReplyMissing ? null : reply.content;
    process.stdout.write(`${JSON.stringify({ content: scheduledPrompt, reply: replyMessage })}\n`);
  } else if (reply == null) {
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

const readScheduledTaskCadence = (settings: TaskCommandSettings): string | undefined => {
  if (settings.every) return `every ${settings.every}`;

  if (settings.at) return `at ${settings.at}`;

  return undefined;
};

export const runChromeStart = async (settings: ChromeStartSettings = {}): Promise<void> => {
  const browser = await launchChromeBrowser(settings);
  await browser.closeOwnTab();
  writeChromeStartInstructions(readProvider(readProviderIdFrom(settings.provider)).displayName);
};

const launchChromeBrowser = async (settings: ChromeStartSettings): Promise<BrowserSession> => {
  const provider = readProviderIdFrom(settings.provider);
  const browser = new BrowserSession(provider, {
    debugPort: parsePortFlag(DEBUG_PORT_FLAG, settings.debugPort),
    profileRoot: readProfileRootFromOption(settings.profile),
  });

  await browser.launch();

  return browser;
};

const writeChromeStartInstructions = (displayName: string): void => {
  const isMyChromeChosen = readConfiguredBrowserChoice() === "my-chrome";
  if (isMyChromeChosen) {
    process.stderr.write(
      `Connected to your own Chrome for ${displayName}.
Each command opens its own tab there and closes it when done. Click Allow when Chrome asks.
`,
    );
    return;
  }

  process.stderr.write(
    `Chrome is open for ${displayName} with the bridge debug port.
This uses the shared bridge Chrome profile, so sign in once in this window and every repo can reuse it.
Leave this Chrome window open; \`bridge ask\` will reconnect to it.
`,
  );
};

export const runStop = async (): Promise<void> => {
  const killed = await terminateChromeOnDebugPort(BRIDGE_DEBUG_PORT);
  process.stderr.write(
    killed ? "Closed the bridge browser.\n" : "No bridge browser was running.\n",
  );
};

const runTui = async (settings: CliSettings & { browser?: boolean }): Promise<void> => {
  const isThereNoTerminal = !process.stdout.isTTY;
  if (isThereNoTerminal) {
    failUsage(
      "bridge: the interactive TUI needs a TTY. Use `bridge ask <prompt>` for non-interactive or piped use.",
    );
  }

  const provider = readProviderIdFrom(settings.provider);
  const label = readProviderDisplayName(provider);
  console.log(`\nStarting ai-browser-bridge (${label})...`);
  const engine = await startEngine({
    repoPath: settings.repo ? resolve(settings.repo) : undefined,
    provider,
    mcpPort: parsePortFlag(PORT_FLAG, settings.port),
    withBrowser: settings.browser !== false,
    withTools: provider === CHATGPT_PROVIDER_ID,
    log: (line) => console.error(line),
  });
  await showTui(engine);
};

const showTui = async (engine: Awaited<ReturnType<typeof startEngine>>): Promise<void> => {
  const messages: Message[] = [];
  attachOrchestratorListener({ engine, messages });
  addStopOnInterrupt(() => stopEngine(engine));
  const app = startBridgeApp({ engine, messages, shutdown: () => shutDownTui(engine, app) });
  await app.waitUntilExit();
};

const attachOrchestratorListener = (details: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  messages: Message[];
}): void => {
  details.engine.getOrchestrator().subscribe((event) => {
    const isEventTypeMessage = event.type === "message";
    if (isEventTypeMessage) details.messages.push(event.message);

    const isEventTypeConversationSynced = event.type === "conversation_synced";
    if (isEventTypeConversationSynced) {
      details.messages.length = 0;
      details.messages.push(...event.messages);
    }

    const isEventTypeReset = event.type === "reset";
    if (isEventTypeReset) details.messages.length = 0;

    const isEventTypeError = event.type === "error";
    if (isEventTypeError) {
      details.messages.push({
        id: crypto.randomUUID(),
        role: "assistant",
        content: `⚠ ${event.error}`,
        timestamp: Date.now(),
      });
    }
  });
};

const shutDownTui = async (
  engine: Awaited<ReturnType<typeof startEngine>>,
  app: ReturnType<typeof render>,
): Promise<void> => {
  await stopEngine(engine);
  app.unmount();
};

const startBridgeApp = (details: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  messages: Message[];
  shutdown: () => Promise<void>;
}): ReturnType<typeof render> => {
  return render(
    React.createElement(BridgeApp, {
      config: details.engine.config,
      sendMessage: async (message: string) => {
        await details.engine.ask({ content: message });
      },
      clearMessages: () => {
        details.messages.length = 0;
      },
      shutdown: details.shutdown,
      messages: details.messages,
      counter: details.engine.counter,
      orchestrator: details.engine.getOrchestrator(),
      permission: {
        getMode: () => details.engine.permissionMode,
        setMode: (mode) => {
          details.engine.permissionMode = mode;
        },
      },
      session: {
        getId: () => details.engine.sessionId,
        setId: (id) => {
          details.engine.sessionId = id;
        },
      },
      statusline: {
        branch: details.engine.branch,
        toolCallCount: () => details.engine.toolActions.length,
      },
    }),
  );
};

export const runInteractiveCli = async (
  settings: CliSettings & { browser?: boolean },
): Promise<void> => {
  await runTui(settings);
};

export const runAsk = async (prompt: string, settings: AskSettings): Promise<void> => {
  await runAskFlow({ prompt, options: settings });
};

const createRenderStatusLine = (status: ChatGptRenderStatus): string => {
  const parts = [
    status.streaming ? "streaming" : "idle",
    `images ${status.images.loaded}/${status.images.total}`,
  ];

  const hasPendingImages = status.images.pending > 0;
  if (hasPendingImages) parts.push(`${status.images.pending} pending`);

  const hasExpectedImages = status.expectedImageMarkers > 0;
  if (hasExpectedImages) parts.push(`${status.expectedImageMarkers} expected`);

  if (status.misfireSuspected) parts.push("misfire?");

  if (status.limitHit) {
    const limitNotice = status.limitNotice == null ? "hit" : status.limitNotice;
    parts.push(`limit: ${limitNotice}`);
  }

  return parts.join(" | ");
};

export const runChatgptInspect = async (settings: ChatgptCommandSettings): Promise<void> => {
  const { engine, page } = await startWorkspaceSession(settings);

  if (settings.allTabs) {
    const tabs = await readAllChatGptTabRenderStatuses(page);
    await engine.shutDown({ closeBrowser: false });

    if (settings.json) process.stdout.write(`${JSON.stringify(tabs)}\n`);
    else if (tabs.length === 0) process.stdout.write("No ChatGPT tabs open.\n");
    else
      for (const tab of tabs) process.stdout.write(`${createRenderStatusLine(tab)}\t${tab.url}\n`);

    return;
  }

  const status = await readChatGptRenderStatus(page);
  await engine.shutDown({ closeBrowser: false });
  process.stdout.write(
    settings.json ? `${JSON.stringify(status)}\n` : `${createRenderStatusLine(status)}\n`,
  );
};

const startFlowSession = async (settings: FlowCommandSettings) => {
  const engine = await startEngine({
    repoPath: settings.repo ? resolve(settings.repo) : undefined,
    provider: "flow",
    mcpPort: parsePortFlag(PORT_FLAG, settings.port),
    withBrowser: true,
    withTools: false,
    debugPort: parsePortFlag(DEBUG_PORT_FLAG, settings.debugPort),
    profileRoot: readProfileRootFromOption(settings.profile),
  });

  return { engine, page: requireBrowserPage(engine) };
};

const DESIGN_ATTACH_WAIT_MS = 30_000;

// Throws instead of exiting so `bridge serve` reports a missing browser per tool call.
const startDesignSession = async (settings: CliSettings & BrowserTargetSettings) => {
  const engine = await startEngine({
    repoPath: settings.repo ? resolve(settings.repo) : undefined,
    provider: "design",
    mcpPort: parsePortFlag(PORT_FLAG, settings.port),
    withBrowser: true,
    withTools: false,
    persist: false,
    debugPort: parsePortFlag(DEBUG_PORT_FLAG, settings.debugPort),
    profileRoot: readProfileRootFromOption(settings.profile),
  });

  const browser = engine.browser;

  const isBrowserMissing = browser == null;
  if (isBrowserMissing) {
    await Promise.allSettled([engine.shutDown({ closeBrowser: false })]);
    throw new Error(
      "Browser not connected. Run `bridge chrome start --provider design` and sign in at claude.ai.",
    );
  }

  // Attaching starts the move to claude.ai/design without awaiting it; a second
  // navigation on the same tab would abort the first, so wait for it to land.
  const page = browser.getPage();
  try {
    await page.waitForURL((url) => readProviderIdForUrl(url.href) === "design", {
      timeout: DESIGN_ATTACH_WAIT_MS,
    });
  } catch (error) {
    await Promise.allSettled([engine.shutDown({ closeBrowser: false })]);
    throw error;
  }
  return { engine, page };
};

export const runWithDesignPage = async <T>(
  settings: CliSettings & BrowserTargetSettings,
  runPage: (page: Page, repoRoot: string) => Promise<T>,
): Promise<T> => {
  const { engine, page } = await startDesignSession(settings);

  try {
    return await runPage(page, engine.config.repoPath);
  } finally {
    await Promise.allSettled([engine.shutDown({ closeBrowser: false })]);
  }
};

const readDefaultFlowPrintoutDirectory = (repoRoot: string): string =>
  join(readDownloadsDirectory(repoRoot), "flow");

const requireClipId = (settings: FlowCommandSettings, verb: string): string => {
  const id = settings.id?.[0];

  const isIdBlank = id == null || id === "";
  if (isIdBlank) return failUsage(`Usage: bridge flow ${verb} --id <clipId>`);

  return id;
};

export const runFlowClips = async (settings: FlowCommandSettings): Promise<void> => {
  const { engine, page } = await startFlowSession(settings);
  const clips = await listClips(page);
  await engine.shutDown({ closeBrowser: false });

  if (settings.json) process.stdout.write(`${JSON.stringify(clips)}\n`);
  else if (clips.length === 0) process.stdout.write("No clips in the current Flow project.\n");
  else for (const clip of clips) process.stdout.write(`${clip.id}\t${clip.url}\n`);
};

export const runFlowProjects = async (settings: FlowCommandSettings): Promise<void> => {
  const { engine, page } = await startFlowSession(settings);
  const projects = await listFlowProjects(page);
  await engine.shutDown({ closeBrowser: false });

  if (settings.json) process.stdout.write(`${JSON.stringify(projects)}\n`);
  else if (projects.length === 0) process.stdout.write("No Flow projects.\n");
  else for (const project of projects) process.stdout.write(`${project.id}\t${project.title}\n`);
};

export const runFlowDownload = async (settings: FlowCommandSettings): Promise<void> => {
  const { engine, page } = await startFlowSession(settings);
  const clips = await listClips(page);
  const hasId = settings.id && settings.id.length > 0;
  const targets = hasId ? settings.id : clips.map((clip) => clip.id);
  const outDir = settings.out
    ? resolve(settings.out)
    : readDefaultFlowPrintoutDirectory(engine.config.repoPath);
  const reports: Array<{ id: string; ok: boolean; file?: string; error?: string }> = [];
  for (const id of targets) {
    try {
      reports.push({ id, ok: true, file: await downloadClip(page, id, outDir) });
    } catch (caughtError) {
      const isErrorObject = caughtError instanceof Error;
      reports.push({
        id,
        ok: false,
        error: isErrorObject ? caughtError.message : String(caughtError),
      });
    }
  }
  await engine.shutDown({ closeBrowser: false });

  if (settings.json) process.stdout.write(`${JSON.stringify(reports)}\n`);
  else if (reports.length === 0) process.stdout.write("No clips to download.\n");
  else
    for (const download of reports) {
      if (download.ok)
        process.stdout.write(`${download.id}	${download.file}
`);
      else
        process.stdout.write(`${download.id}	ERROR ${download.error}
`);
    }

  const isAnyDownloadFailed = !reports.every((download) => download.ok);
  if (isAnyDownloadFailed) throw new Error("Some downloads failed.");
};

export const runFlowGenerate = async (settings: FlowCommandSettings): Promise<void> => {
  const startFramePath = settings.start ? resolve(settings.start) : "";

  const prompt = settings.prompt == null ? "" : settings.prompt.trim();

  const isVideoSetupIncomplete = !startFramePath || !prompt;
  if (isVideoSetupIncomplete) {
    failUsage("Usage: bridge flow generate --start <imagePath> --prompt <text> [--out <dir>]");
  }

  const { engine, page } = await startFlowSession(settings);
  const outDir = settings.out
    ? resolve(settings.out)
    : readDefaultFlowPrintoutDirectory(engine.config.repoPath);
  try {
    const clip = await generateClipFromFrame(page, {
      startFramePath,
      prompt,
      onProgress: (message) => process.stderr.write(`flow generate: ${message}\n`),
    });
    const file = await downloadClip(page, clip.id, outDir);
    await engine.shutDown({ closeBrowser: false });

    if (settings.json)
      process.stdout.write(`${JSON.stringify({ id: clip.id, url: clip.url, file })}\n`);
    else process.stdout.write(`${clip.id}\t${file}\n`);

    return;
  } catch (error) {
    await Promise.allSettled([engine.shutDown({ closeBrowser: false })]);
    const isErrorObject = error instanceof Error;
    return fail(isErrorObject ? error.message : String(error));
  }
};

export const runFlowDelete = async (settings: FlowCommandSettings): Promise<void> => {
  const id = requireClipId(settings, "delete");

  const isYesNotGiven = !settings.yes;
  if (isYesNotGiven) {
    failUsage(
      "Refusing to delete without --yes. `bridge flow delete --id <clipId> --yes` moves the clip to Flow Trash (recoverable).",
    );
  }

  const { engine, page } = await startFlowSession(settings);
  await deleteClip(page, id);
  await engine.shutDown({ closeBrowser: false });
  process.stdout.write(
    settings.json
      ? `${JSON.stringify({ id, movedToTrash: true })}\n`
      : `Moved clip ${id} to Trash.\n`,
  );
};

export const runFlowRename = async (settings: FlowCommandSettings): Promise<void> => {
  const id = requireClipId(settings, "rename");

  const name = settings.name?.trim();

  const isNameEmpty = !name;
  if (isNameEmpty) return failUsage("Usage: bridge flow rename --id <clipId> --name <text>");

  const { engine, page } = await startFlowSession(settings);
  await renameClip(page, id, name);
  await engine.shutDown({ closeBrowser: false });
  process.stdout.write(
    settings.json ? `${JSON.stringify({ id, name })}\n` : `Renamed clip ${id} to "${name}".\n`,
  );
};

export const runFlowExtend = async (settings: FlowCommandSettings): Promise<void> => {
  const id = requireClipId(settings, "extend");
  const { engine, page } = await startFlowSession(settings);

  await addClipToScene(page, id);
  await engine.shutDown({ closeBrowser: false });
  process.stdout.write(
    settings.json
      ? `${JSON.stringify({ id, addedTo: "scene" })}\n`
      : `Added clip ${id} to scene.\n`,
  );
};

export const runFlowReuse = async (settings: FlowCommandSettings): Promise<void> => {
  const id = requireClipId(settings, "reuse");
  const { engine, page } = await startFlowSession(settings);

  await addClipToPrompt(page, id);
  await engine.shutDown({ closeBrowser: false });
  process.stdout.write(
    settings.json
      ? `${JSON.stringify({ id, addedTo: "prompt" })}\n`
      : `Added clip ${id} to prompt.\n`,
  );
};

export const runFlowProjectRename = async (settings: FlowCommandSettings): Promise<void> => {
  const name = settings.name?.trim();

  const isNameEmpty = !name;
  if (isNameEmpty) return failUsage("Usage: bridge flow project-rename --name <text>");

  const { engine, page } = await startFlowSession(settings);
  await renameFlowProject(page, name);
  await engine.shutDown({ closeBrowser: false });
  process.stdout.write(
    settings.json ? `${JSON.stringify({ project: name })}\n` : `Renamed project to "${name}".\n`,
  );
};

export const runFlowProjectDelete = async (settings: FlowCommandSettings): Promise<void> => {
  const isYesNotGiven = !settings.yes;
  if (isYesNotGiven) {
    failUsage(
      "Refusing to delete a project without --yes. `bridge flow project-delete --yes` permanently deletes the current project.",
    );
  }

  const { engine, page } = await startFlowSession(settings);
  await deleteFlowProject(page);
  await engine.shutDown({ closeBrowser: false });
  process.stdout.write(
    settings.json
      ? `${JSON.stringify({ deleted: true })}\n`
      : "Deleted the current Flow project.\n",
  );
};

export const runFlowIngredients = async (settings: FlowCommandSettings): Promise<void> => {
  const { engine, page } = await startFlowSession(settings);
  const ingredients = await listIngredients(page);
  await engine.shutDown({ closeBrowser: false });

  if (settings.json) process.stdout.write(`${JSON.stringify(ingredients)}\n`);
  else if (ingredients.length === 0)
    process.stdout.write("No ingredients attached to the prompt.\n");
  else for (const element of ingredients) process.stdout.write(`${element.id}\t${element.url}\n`);
};

export const runFlowIngredientRemove = async (settings: FlowCommandSettings): Promise<void> => {
  const id = settings.id?.[0];

  const isIdBlank = id == null || id === "";
  if (isIdBlank) return failUsage("Usage: bridge flow ingredient-remove --id <mediaId>");

  const { engine, page } = await startFlowSession(settings);
  await removeIngredient(page, id);
  await engine.shutDown({ closeBrowser: false });
  process.stdout.write(
    settings.json ? `${JSON.stringify({ id, removed: true })}\n` : `Removed ingredient ${id}.\n`,
  );
};

export const runFlowIngredientClear = async (settings: FlowCommandSettings): Promise<void> => {
  const { engine, page } = await startFlowSession(settings);
  const removed = await clearIngredients(page);

  await engine.shutDown({ closeBrowser: false });
  process.stdout.write(
    settings.json ? `${JSON.stringify({ removed })}\n` : `Removed ${removed} ingredient(s).\n`,
  );
};
