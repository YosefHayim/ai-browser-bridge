import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { render } from "ink";
import type { Page } from "playwright";
import React from "react";
import type { AskGatewayDeps } from "@/agent-gateway/ask-gateway-server.ts";
import { serveAskGatewayStdio } from "@/agent-gateway/serve-ask-gateway.ts";
import { type BridgeEngine, startEngine } from "@/bridge/bridge-engine.ts";
import { type FanoutTask, FanoutTasksSchema } from "@/bridge/bridge-schemas.ts";
import { fanOutConversations } from "@/bridge/fanout.ts";
import { type FanoutOptions, type FanoutResult, fanoutFailed } from "@/bridge/fanout-pool.ts";
import { bridgeChromeProfileRoot, configuredBrowserChoice } from "@/browser/browser-profile.ts";
import type { BrowserStatus, CacheInventory, PruneCacheResult } from "@/browser/browser-schemas.ts";
import {
  BRIDGE_DEBUG_PORT,
  BrowserSession,
  terminateChromeOnDebugPort,
} from "@/browser/browser-session.ts";
import { readBrowserStatus } from "@/browser/browser-state.ts";
import { inventoryChromeCache, pruneChromeCache } from "@/browser/chrome-cache.ts";
import { type BridgeProviderId, DEFAULT_PROVIDER } from "@/config";
import type { ConversationSearchResult } from "@/conversation-catalog/conversation-catalog-schemas.ts";
import type { Attachment } from "@/domain/attachment-types.ts";
import type { CommandContext, CommandDef } from "@/domain/command-types.ts";
import type { ConnectorSetupResult } from "@/domain/connector-types.ts";
import type { Message } from "@/domain/message-types.ts";
import { findModelProfile, listModelProfiles } from "@/domain/model-lookup.ts";
import { normalizePermissionMode, PERMISSION_MODES } from "@/domain/permissions.ts";
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
  type ChatGptRenderState,
  readAllChatGptTabRenderStates,
  readChatGptRenderState,
} from "@/providers/chatgpt/chatgpt-render-state.ts";
import {
  type ArchiveChatOutcome,
  archiveChat,
  createProject,
  deleteProject,
  listProjects,
  listTasks,
  type MoveChatOutcome,
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
import { bridgeLogPath } from "@/store/logging.ts";
import {
  attachmentManifestsDir,
  downloadsDir,
  exportsDir,
  repositoryPath,
  repositoryRoot,
  screenshotsDir,
  sessionsDir,
} from "@/store/paths.ts";
import {
  exportSession,
  getLatestSession,
  listSessions,
  loadSession,
  type SessionExport,
  type SessionMetadata,
  type SessionStoreOptions,
} from "@/store/session-store.ts";
import { toolRegistry, trimOutput } from "@/tools/mcp-server.ts";
import { loadCustomCommands, renderCustomCommandPrompt } from "@/user-config/custom-commands.ts";
import { loadProjectInstructions } from "@/user-config/project-instructions.ts";
import {
  acquireChatOrganizationQueueLock,
  type ChatOrganizationInterval,
  type ChatOrganizationPacing,
  type ChatOrganizationQueue,
  clampChatOrganizationPacing,
  clearChatOrganizationQueuePause,
  completeChatOrganizationQueueItem,
  createInitialChatOrganizationPacing,
  deferChatOrganizationQueueItem,
  failChatOrganizationQueueItem,
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
  reopenChatOrganizationQueueItems,
  slowDownPacingAfterRateLimit,
  speedUpPacingAfterSuccess,
  summarizeChatOrganizationQueue,
  updateChatOrganizationQueuePacing,
  updateChatOrganizationQueueVerification,
  verifyChatOrganizationQueue,
} from "./chat-organization-queue.ts";
import { createUsageError } from "./cli-failure.ts";
import type {
  AskOptions,
  BrowserStatusOptions,
  BrowserTargetOptions,
  CacheCmdOptions,
  ChatCmdOptions,
  ChatgptCmdOptions,
  ChatOrganizationOptions,
  ChromeStartOptions,
  CliOptions,
  DownloadCmdOptions,
  DownloadResult,
  FlowCmdOptions,
  ProjectCmdOptions,
  ServeOptions,
  TaskCmdOptions,
} from "./cli-types.ts";
import { readProviderDisplayName } from "./provider-label.ts";
import { BridgeApp } from "./tui/shell/app.tsx";
import { addStopOnInterrupt } from "./user-interrupt.ts";

const SESSION_COMMANDS: CommandMeta[] = [
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
];

const MODEL_COMMANDS: CommandMeta[] = [
  { name: "model", description: "Show or switch the ChatGPT model" },
  { name: "context", description: "Show context window usage" },
];

const MCP_COMMANDS: CommandMeta[] = [
  {
    name: "task",
    aliases: ["work"],
    description: "Send a project-agent task with MCP tool instructions",
  },
  { name: "permissions", description: "Show or switch MCP permission mode" },
  { name: "mcp", description: "Show MCP connector setup and exposed tools" },
  { name: "connector", description: "Open ChatGPT MCP connector setup" },
  { name: "review", description: "Ask ChatGPT to review local changes" },
];

const BROWSER_COMMANDS: CommandMeta[] = [
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
];
const RED = "\u001b[31m";

const RESET = "\u001b[0m";

type CommandMeta = {
  name: string;
  description: string;
  aliases?: string[];
};

export const createProjectTaskPrompt = (task: string, ctx: CommandContext): string => {
  return createProjectTaskPromptWithInstructions(task, ctx, "");
};

// Front-loads a "prove the connector is active" step: if ChatGPT answers from
// `/mnt/data` or asks for a zip/tree, the connector is not wired up.
export const createProjectTaskPromptWithInstructions = (
  task: string,
  ctx: CommandContext,
  projectInstructions: string,
): string => {
  const hasProjectInstructions = projectInstructions.trim();
  return [
    "You are helping me modify this local project through the registered MCP connector.",
    "",
    "Project context:",
    `- Repo path: ${ctx.config.repoPath}`,
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
  ].join("\n");
};

// null when no tunnel; otherwise `<url>/mcp` unless already `/mcp` or `/sse`.
export const readMcpConnectorUrl = (tunnelUrl?: string): string | null => {
  const isTunnelUrlBlank = tunnelUrl === undefined || tunnelUrl === "";
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
  ].join("\n");
};

const readSessionModelLabel = (model: string | null | undefined): string => {
  const isModelBlank = model === undefined || model === null || model === "";
  if (isModelBlank) return "unknown";

  return model;
};

const readSessionTunnelLabel = (tunnelUrl: string | null | undefined): string => {
  const isTunnelUrlBlank = tunnelUrl === undefined || tunnelUrl === null || tunnelUrl === "";
  if (isTunnelUrlBlank) return "none";

  return tunnelUrl;
};

const createBridgeStatus = (ctx: CommandContext): string => {
  const provider = readProviderIdFrom(ctx.config.provider);
  return [
    `Provider: ${provider}`,
    `Repo: ${ctx.config.repoPath}`,
    `Branch: ${readStatusBranchLabel(ctx)}`,
    `Session: ${readStatusSessionLabel(ctx)}`,
    `Model: ${ctx.counter.modelLabel}`,
    `Context: ${ctx.counter.summary}`,
    `Permission: ${readStatusPermissionLabel(ctx)}`,
    `Tool calls: ${readStatusToolCallCount(ctx)}`,
    `Tunnel: ${readStatusTunnelLabel(ctx)}`,
    `Connector: ${readStatusConnectorLabel(ctx)}`,
  ].join("\n");
};

const readStatusBranchLabel = (ctx: CommandContext): string => {
  const branch = ctx.statusline?.branch;
  const isBranchBlank = branch === undefined || branch === "";
  if (isBranchBlank) return "unknown";

  return branch;
};

const readStatusSessionLabel = (ctx: CommandContext): string => {
  const sessionId = ctx.session?.getId();
  const isSessionIdBlank = sessionId === undefined || sessionId === "";
  if (isSessionIdBlank) return "none";

  return sessionId;
};

const readStatusPermissionLabel = (ctx: CommandContext): string => {
  const liveMode = ctx.permission?.getMode();

  const hasLiveMode = liveMode !== undefined;
  if (hasLiveMode) return liveMode;

  if (ctx.config.permissionMode !== undefined) return ctx.config.permissionMode;

  return "auto";
};

const readStatusToolCallCount = (ctx: CommandContext): number => {
  const liveCount = ctx.statusline?.toolCallCount();

  const hasLiveCount = liveCount !== undefined;
  if (hasLiveCount) return liveCount;

  return 0;
};

const readStatusTunnelLabel = (ctx: CommandContext): string => {
  if (ctx.config.tunnelUrl === undefined || ctx.config.tunnelUrl === "") return "none";

  return ctx.config.tunnelUrl;
};

const readStatusConnectorLabel = (ctx: CommandContext): string => {
  const connector = readMcpConnectorUrl(ctx.config.tunnelUrl);

  const isConnectorMissing = connector === null;
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
  ].join("\n");
};

const readBrowserProfileRootLabel = (status: BrowserStatus): string => {
  const hasStatusUserDir = status.userDataDir !== undefined && status.userDataDir !== null;
  if (hasStatusUserDir) return status.userDataDir;

  return status.bridgeProfileRoot;
};

const createCacheInventory = (inventory: CacheInventory): string => {
  const lines = [
    `Chrome profile root: ${inventory.profileRoot}`,
    `Reclaimable generated cache: ${inventory.reclaimableBytes} bytes`,
    "",
    "Safe generated-cache targets:",
  ];
  for (const entry of inventory.entries) {
    const exists = entry.exists ? `${entry.bytes} bytes` : "missing";
    lines.push(`  ${entry.relativePath.padEnd(40)} ${exists}`);
  }
  return lines.join("\n");
};

const createCachePruneResult = (result: PruneCacheResult): string => {
  return [
    `Chrome profile root: ${result.profileRoot}`,
    `Mode: ${result.dryRun ? "dry-run" : "confirmed prune"}`,
    `Deleted generated cache: ${result.deletedBytes} bytes`,
    "",
    "Safe generated-cache targets:",
    ...result.entries.map((entry) => {
      const status = entry.exists ? `${entry.bytes} bytes` : "missing";
      return `  ${entry.relativePath.padEnd(40)} ${status}`;
    }),
  ].join("\n");
};

const createMcpDiagnostics = (ctx: CommandContext): string => {
  const toolCallCount = readStatusToolCallCount(ctx);
  return [
    "MCP bridge diagnostics:",
    `Local server: http://localhost:${ctx.config.mcpPort}`,
    `Tunnel: ${readStatusTunnelLabel(ctx)}`,
    `Connector: ${readStatusConnectorLabel(ctx)}`,
    `Tools: ${[...toolRegistry.keys()].join(", ")}`,
    `Tool calls observed this session: ${toolCallCount}`,
    `Status: ${readMcpToolCallStatusLabel(toolCallCount)}`,
    "",
    "If ChatGPT says it cannot access local files:",
    "1. Startup automatically syncs the current Connector URL into ChatGPT when browser automation is connected.",
    "2. Run /connector only to retry that browser setup flow after a UI drift or account permission issue.",
    "3. Ask explicitly: use the ai-browser-bridge connector; do not answer from memory.",
    "4. A reply mentioning /mnt/data, upload a zip, or paste tree/find output means ChatGPT is not using this local connector.",
  ].join("\n");
};

const readMcpToolCallStatusLabel = (toolCallCount: number): string => {
  const hasToolCalls = toolCallCount > 0;
  if (hasToolCalls) return "MCP tool calls observed in this bridge session.";

  return "No MCP tool calls observed yet; the current ChatGPT chat may not have the connector enabled.";
};

const createConnectorSetupResult = (result: ConnectorSetupResult): string => {
  const isStepsNotEmpty = result.steps.length > 0;
  const isWarningsNotEmpty = result.warnings.length > 0;
  return [
    "",
    "Connector setup result:",
    `URL: ${result.connectorUrl}`,
    `Submitted: ${result.completed ? "yes" : "no"}`,
    ...(isStepsNotEmpty ? ["", "Steps:", ...result.steps.map((step) => `- ${step}`)] : []),
    ...(isWarningsNotEmpty
      ? ["", "Needs manual attention:", ...result.warnings.map((warning) => `- ${warning}`)]
      : []),
    "",
    "Automatic startup handles this on each restart when the browser is connected. Manual fallback: ChatGPT Settings -> Apps -> Advanced settings -> Create app, paste the Connector URL, choose no authentication, then enable it in Developer Mode for this chat.",
  ].join("\n");
};

const printAttachmentTable = (attachments: Attachment[]): void => {
  const isAttachmentsEmpty = attachments.length === 0;
  if (isAttachmentsEmpty) {
    console.log("No attachments captured in this conversation yet.");
    return;
  }

  const rows = [
    ["id", "role", "kind", "filename", "message"],
    ...attachments.map((attachment) => [
      attachment.id,
      attachment.role,
      attachment.kind,
      attachment.filename === undefined ? "" : attachment.filename,
      String(attachment.messageIndex),
    ]),
  ];
  const widths = computeColumnWidths(rows);
  for (const row of rows) {
    console.log(createTableRow({ row, widths }));
  }
};

const computeColumnWidths = (rows: string[][]): number[] => {
  const header = rows[0];

  const isHeaderMissing = header === undefined;
  if (isHeaderMissing) return [];

  return header.map((...args: [string, number]) => readMaxColumnLength({ rows, column: args[1] }));
};

const readMaxColumnLength = (input: { rows: string[][]; column: number }): number => {
  return Math.max(
    ...input.rows.map((row) => {
      const cell = row[input.column];

      const isCellMissing = cell === undefined;
      if (isCellMissing) return 0;

      return cell.length;
    }),
  );
};

const createTableRow = (input: { row: string[]; widths: number[] }): string => {
  return input.row
    .map((...args: [string, number]) =>
      padTableCell({ cell: args[0], column: args[1], widths: input.widths }),
    )
    .join("  ");
};

const padTableCell = (input: { cell: string; column: number; widths: number[] }): string => {
  const width = input.widths[input.column];

  const isWidthMissing = width === undefined;
  if (isWidthMissing) return input.cell;

  return input.cell.padEnd(width);
};

const splitArgs = (input: string): string[] => {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (const char of input.trim()) {
    const next = consumeSplitChar({ char, quote, current, args });
    current = next.current;
    quote = next.quote;
  }
  return finalizeSplitArgs({ current, args });
};

const finalizeSplitArgs = (input: { current: string; args: string[] }): string[] => {
  // Empty current means no trailing token ("" is a valid string, not "absent").
  const isCurrentNotEmpty = input.current !== "";
  if (isCurrentNotEmpty) input.args.push(input.current);

  return input.args;
};

const consumeSplitChar = (input: {
  char: string;
  quote: "'" | '"' | null;
  current: string;
  args: string[];
}): { current: string; quote: "'" | '"' | null } => {
  if ((input.char === "'" || input.char === '"') && input.quote === null) {
    return { current: input.current, quote: input.char };
  }

  if (input.char === input.quote) return { current: input.current, quote: null };

  if (/\s/.test(input.char) && input.quote === null) {
    const isCurrentNotEmpty = input.current !== "";
    if (isCurrentNotEmpty) input.args.push(input.current);

    return { current: "", quote: input.quote };
  }

  return { current: input.current + input.char, quote: input.quote };
};

type RuntimeOrchestrator = {
  page?: Page | null;
};

const readCurrentPage = (ctx: CommandContext): Page | undefined => {
  const orchestrator = ctx.orchestrator as CommandContext["orchestrator"] & RuntimeOrchestrator;
  if (orchestrator.page === null || orchestrator.page === undefined) return undefined;

  return orchestrator.page;
};

const readConversationIdFromPage = (page: Page): string => {
  const conversationId = readChatGptConversationIdFromUrl(page.url());
  const isConversationIdMissing = conversationId === undefined || conversationId === null;
  if (isConversationIdMissing) return "current";

  return conversationId;
};

const parseOutDir = (args: string[]): string | undefined => {
  const outIndex = args.indexOf("--out");
  const isOutMarkerNotFound = outIndex === -1;
  if (isOutMarkerNotFound) return undefined;

  return args[outIndex + 1];
};

const printError = (message: string): void => {
  console.error(`${RED}${message}${RESET}`);
};

type FilesDownloadInput = {
  page: Page;
  conversationId: string;
  parts: string[];
  manifestIds: string[];
  repoRoot: string;
};

const downloadFilesCommand = async (input: FilesDownloadInput): Promise<void> => {
  const outDir = parseOutDir(input.parts.slice(2));

  if (input.parts[1] === "all") {
    const results = await downloadAll(input.page, input.conversationId, {
      repoRoot: input.repoRoot,
      manifestRoot: downloadsDir(input.repoRoot),
      ...(outDir ? { outDir } : {}),
    });
    printBulkDownloadResults(results);
    return;
  }

  await downloadOneAttachment({ input, outDir });
};

const downloadOneAttachment = async (input: {
  input: FilesDownloadInput;
  outDir: string | undefined;
}): Promise<void> => {
  const id = input.input.parts[1];
  const isIdBlank = id === undefined || id === "";
  if (isIdBlank) {
    printError("Usage: download <attachment-id>");
    return;
  }

  const isNotIdInManifestIds = !input.input.manifestIds.includes(id);
  if (isNotIdInManifestIds) {
    printError(`No attachment with id "${id}".`);
    return;
  }

  const downloaded = await downloadAttachment({
    page: input.input.page,
    conversationId: input.input.conversationId,
    id,
    opts: {
      repoRoot: input.input.repoRoot,
      manifestRoot: downloadsDir(input.input.repoRoot),
      ...(input.outDir ? { outDir: input.outDir } : {}),
    },
  });
  console.log(downloaded.path);
};

const printBulkDownloadResults = (
  results: ReadonlyArray<{ id: string; path: string; bytes: number; error?: string }>,
): void => {
  const succeeded = results.filter((item) => item.error === undefined).length;
  const failed = results.length - succeeded;
  let summary = `Downloaded ${succeeded}/${results.length} attachments`;

  const hasFailures = failed > 0;
  if (hasFailures) summary = `${summary} (${failed} failed)`;

  console.log(`${summary}.`);
  for (const item of results) {
    if (item.error !== undefined) {
      printError(`${item.id}: ${item.error}`);
      continue;
    }

    console.log(`${item.id} -> ${item.path} (${item.bytes} bytes)`);
  }
};

const filesCommand: CommandDef = {
  name: "files",
  description: "List or download ChatGPT conversation attachments",
  handler: (...args: [string, CommandContext]) =>
    runRouteFilesCommand({ args: args[0], ctx: args[1] }),
};

const runRouteFilesCommand = async (input: {
  args: string;
  ctx: CommandContext;
}): Promise<void> => {
  const context = await loadFilesContext(input);
  const parts = splitArgs(input.args);

  const isPartsEmpty = parts.length === 0;
  if (isPartsEmpty) return printAttachmentTable(context.manifest.attachments);

  await runRouteFilesDownload({ parts, context });
};

const loadFilesContext = async (input: { args: string; ctx: CommandContext }) => {
  const page = readCurrentPage(input.ctx);
  const conversationId = page ? readConversationIdFromPage(page) : "current";
  const manifest = await loadManifest(conversationId, {
    manifestRoot: downloadsDir(input.ctx.config.repoPath),
  });
  return { page, conversationId, manifest, repoRoot: input.ctx.config.repoPath };
};

const runRouteFilesDownload = async (input: {
  parts: string[];
  context: {
    page: Page | undefined;
    conversationId: string;
    manifest: Awaited<ReturnType<typeof loadManifest>>;
    repoRoot: string;
  };
}): Promise<void> => {
  if (input.parts[0] !== "get")
    return console.log("Usage: /files [get <id>|get all [--out <dir>]]");

  if (!input.parts[1]) return console.log("Usage: /files get <id> or /files get all [--out <dir>]");

  if (input.context.page === undefined) {
    printError("Browser not connected. Cannot download attachments.");
    return;
  }

  await downloadFilesCommand({
    page: input.context.page,
    conversationId: input.context.conversationId,
    parts: input.parts,
    manifestIds: input.context.manifest.attachments.map((item) => item.id),
    repoRoot: input.context.repoRoot,
  });
};

const readSessionStore = (repoPath: string): SessionStoreOptions => {
  return { baseDir: sessionsDir(repoPath) };
};

type TryLoadSessionParams = {
  sessionId: string;
  options: SessionStoreOptions;
};

const tryLoadSession = async (params: TryLoadSessionParams) => {
  try {
    return await loadSession(params.sessionId, params.options);
  } catch {
    return null;
  }
};

type SessionIdInput = {
  args: string;
  ctx: CommandContext;
};

const readRequestedOrCurrentSessionId = async (params: SessionIdInput): Promise<string | null> => {
  const [requested] = splitArgs(params.args);
  if (requested) return requested;

  if (params.ctx.session?.getId()) return params.ctx.session.getId();

  const latest = await getLatestSession(readSessionStore(params.ctx.config.repoPath));

  const isLatestMissing = latest === null;
  if (isLatestMissing) return null;

  return latest.metadata.id;
};

type RepositoryFileInput = {
  repoRoot: string;
  input: string;
};

const createRepositoryFilePath = (params: RepositoryFileInput): string => {
  if (isAbsolute(params.input)) {
    const rel = relative(resolve(params.repoRoot), resolve(params.input));
    return repositoryPath(params.repoRoot, rel || ".");
  }

  return repositoryPath(params.repoRoot, params.input);
};

const assertImagePath = (path: string): void => {
  const extension = extname(path).toLowerCase();
  const isNotImageExtension = ![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extension);
  if (isNotImageExtension) {
    throw new Error(`Unsupported image type: ${basename(path)}`);
  }
};

const copyTextToClipboard = async (text: string): Promise<void> => {
  await new Promise<void>((...args: [() => void, (reason?: unknown) => void]) => {
    runPbcopy({ text, resolve: args[0], reject: args[1] });
  });
};

const runPbcopy = (input: {
  text: string;
  resolve: () => void;
  reject: (reason?: unknown) => void;
}): void => {
  const child = execFile("pbcopy", (error) => {
    if (error) input.reject(error);
    else input.resolve();
  });
  child.stdin?.end(input.text);
};

type CaptureUrlScreenshotsParams = {
  url: string;
  repoPath: string;
};

const captureUrlScreenshots = async (params: CaptureUrlScreenshotsParams): Promise<string[]> => {
  const parsed = parseCaptureUrl(params.url);
  const dir = await prepareScreenshotDir(params.repoPath);
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
  const dir = join(screenshotsDir(repoPath), stamp);
  await mkdir(dir, { recursive: true });
  return dir;
};

type CaptureWithPlaywrightParams = {
  parsed: string;
  dir: string;
};

const captureWithPlaywright = async (params: CaptureWithPlaywrightParams): Promise<string[]> => {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const outputs: string[] = [];
  try {
    const viewports = [
      { name: "desktop", width: 1440, height: 1000 },
      { name: "mobile", width: 390, height: 844 },
    ];
    for (const viewport of viewports) {
      outputs.push(
        await captureViewport({ browser, viewport, parsed: params.parsed, dir: params.dir }),
      );
    }
  } finally {
    await browser.close();
  }
  return outputs;
};

type CaptureViewportParams = {
  browser: Awaited<ReturnType<Awaited<typeof import("playwright")>["chromium"]["launch"]>>;
  viewport: { name: string; width: number; height: number };
  parsed: string;
  dir: string;
};

const captureViewport = async (params: CaptureViewportParams): Promise<string> => {
  const page = await params.browser.newPage({
    viewport: { width: params.viewport.width, height: params.viewport.height },
  });
  await page.goto(params.parsed, { waitUntil: "networkidle", timeout: 45_000 });
  const file = await writeViewportScreenshot({ page, viewport: params.viewport, dir: params.dir });
  await page.close();
  return file;
};

const writeViewportScreenshot = async (input: {
  page: Awaited<ReturnType<CaptureViewportParams["browser"]["newPage"]>>;
  viewport: CaptureViewportParams["viewport"];
  dir: string;
}): Promise<string> => {
  const file = join(input.dir, `${input.viewport.name}.png`);
  await input.page.screenshot({ path: file, fullPage: true });
  return file;
};

type SessionExportSelection = {
  sessionId: string | null;
  outputPath?: string;
};

type ResolveSessionExportParams = {
  args: string;
  ctx: CommandContext;
};

const readSessionExportFromArgs = async (
  params: ResolveSessionExportParams,
): Promise<SessionExportSelection> => {
  const parts = splitArgs(params.args);

  const isPartsEmpty = parts.length === 0;
  if (isPartsEmpty) {
    return { sessionId: await readRequestedOrCurrentSessionId({ args: "", ctx: params.ctx }) };
  }

  return readSessionExportFromParts({ parts, ctx: params.ctx });
};

const readSessionExportFromParts = async (input: {
  parts: string[];
  ctx: CommandContext;
}): Promise<SessionExportSelection> => {
  const first = input.parts[0] === undefined ? "" : input.parts[0];
  const store = readSessionStore(input.ctx.config.repoPath);

  const session = await tryLoadSession({ sessionId: first, options: store });
  const hasSession = session !== undefined && session !== null;
  if (hasSession) {
    return {
      sessionId: session.metadata.id,
      outputPath: input.parts[1] ? resolve(input.parts[1]) : undefined,
    };
  }

  return {
    sessionId: await readRequestedOrCurrentSessionId({ args: "", ctx: input.ctx }),
    outputPath: resolve(first),
  };
};

const readDefaultExportPath = (params: { repoPath: string; sessionId: string }): string => {
  return join(exportsDir(params.repoPath), `${params.sessionId}.md`);
};

const exportContentForPath = (params: { path: string; exported: SessionExport }): string => {
  const extension = extname(params.path).toLowerCase();
  const isJsonFile = extension === ".json";
  if (isJsonFile) return params.exported.json;

  const isExtensionJsonl = extension === ".jsonl";
  if (isExtensionJsonl) return params.exported.jsonl;

  return params.exported.transcript;
};

const runNewCommand = async (_args: string, ctx: CommandContext): Promise<void> => {
  await ctx.orchestrator.newConversation();
  console.log("Started new conversation.");
};

const stopResponseCommand = async (_args: string, ctx: CommandContext): Promise<void> => {
  const stopped = await ctx.orchestrator.stopResponse();
  console.log(stopped ? "Stopped active response." : "No active response to stop.");
};

const requestCompactCommand = async (_args: string, ctx: CommandContext): Promise<void> => {
  await ctx.sendMessage(
    "Summarize our progress so far in a structured format: what we've done, what's in progress, what's next. Be concise.",
  );
  console.log(
    "Compaction summary requested. Start a new conversation to continue with that summary.",
  );
};

const showLogsCommand = async (_args: string, ctx: CommandContext): Promise<void> => {
  console.log(`Bridge logs: ${bridgeLogPath(ctx.config.repoPath)}`);
};

const showStatusCommand = async (_args: string, ctx: CommandContext): Promise<void> => {
  console.log(createBridgeStatus(ctx));
};

const showStatuslineCommand = async (_args: string, ctx: CommandContext): Promise<void> => {
  console.log(createBridgeStatus(ctx));
};

const clearChatCommand = async (_args: string, ctx: CommandContext): Promise<void> => {
  ctx.clearMessages?.();
  console.log(
    "Cleared terminal chat view. Browser conversation, context estimate, and local session logs are unchanged.",
  );
};

const requestDiffCommand = async (_args: string, ctx: CommandContext): Promise<void> => {
  await ctx.sendMessage("Show me the current git diff for the repository.");
};

const exitBridgeCommand = async (_args: string, ctx: CommandContext): Promise<void> => {
  if (ctx.shutdown) {
    await ctx.shutdown();
    return;
  }

  console.log("Shutting down...");
};

const showHelpCommand = async (_args: string, ctx: CommandContext): Promise<void> => {
  const all = listRegisteredCommands();
  console.log("\nAvailable commands:\n");
  for (const cmd of all) {
    console.log(`  /${cmd.name.padEnd(16)} ${cmd.description}`);
  }
  await printCustomCommands(ctx);
  console.log("");
};

const printCustomCommands = async (ctx: CommandContext): Promise<void> => {
  const custom = await loadCustomCommands({ repoRoot: ctx.config.repoPath });

  const isCustomEmpty = custom.length === 0;
  if (isCustomEmpty) return;

  console.log("\nCustom commands:\n");
  for (const cmd of custom) {
    const description = cmd.description === undefined ? `${cmd.source} command` : cmd.description;
    console.log(`  /${cmd.name.padEnd(16)} ${description}`);
  }
};

const listCustomCommandsCommand = async (_args: string, ctx: CommandContext): Promise<void> => {
  const custom = await loadCustomCommands({ repoRoot: ctx.config.repoPath });

  const isCustomEmpty = custom.length === 0;
  if (isCustomEmpty) {
    console.log("No custom commands found in .bridge/commands or ~/.ai-browser-bridge/commands.");
    return;
  }

  console.log("\nCustom commands:\n");
  for (const command of custom) {
    const description =
      command.description === undefined ? `${command.source} command` : command.description;
    console.log(`  /${command.name.padEnd(16)} ${description}`);
  }
  console.log("");
};

const attachImageCommand = async (args: string, ctx: CommandContext): Promise<void> => {
  const target = args.trim();
  const isTargetEmpty = !target;
  if (isTargetEmpty) {
    console.log("Usage: /attach-image <repo-relative-image-path>");
    return;
  }

  await attachRepoImage({ target, ctx });
};

const attachRepoImage = async (input: { target: string; ctx: CommandContext }): Promise<void> => {
  const imagePath = createRepositoryFilePath({
    repoRoot: input.ctx.config.repoPath,
    input: input.target,
  });
  assertImagePath(imagePath);

  if (!input.ctx.orchestrator.attachFiles) {
    console.log("Browser file attachment is not available.");
    return;
  }

  await input.ctx.orchestrator.attachFiles([imagePath]);
  console.log(`Attached image: ${imagePath}`);
};

const captureScreenshotCommand = async (args: string, ctx: CommandContext): Promise<void> => {
  const url = args.trim();
  const isUrlEmpty = !url;
  if (isUrlEmpty) {
    console.log("Usage: /screenshot <url>");
    return;
  }

  const files = await captureUrlScreenshots({ url, repoPath: ctx.config.repoPath });
  printScreenshotPaths(files);
};

const runUiQaCommand = async (args: string, ctx: CommandContext): Promise<void> => {
  const url = args.trim();
  const isUrlEmpty = !url;
  if (isUrlEmpty) {
    console.log("Usage: /ui-qa <url>");
    return;
  }

  const files = await runUiQaCapture({ url, ctx });
  console.log(`UI QA requested with ${files.length} screenshots.`);
};

const runUiQaCapture = async (input: { url: string; ctx: CommandContext }): Promise<string[]> => {
  const files = await captureUrlScreenshots({
    url: input.url,
    repoPath: input.ctx.config.repoPath,
  });

  if (input.ctx.orchestrator.attachFiles) await input.ctx.orchestrator.attachFiles(files);

  await sendUiQaPrompt({ url: input.url, files, ctx: input.ctx });
  return files;
};

const printScreenshotPaths = (files: string[]): void => {
  console.log("Screenshots:");
  for (const file of files) console.log(`  ${file}`);
};

type SendUiQaPromptParams = {
  url: string;
  files: string[];
  ctx: CommandContext;
};

const sendUiQaPrompt = async (params: SendUiQaPromptParams): Promise<void> => {
  await params.ctx.sendMessage(
    [
      `Review the UI at ${params.url}.`,
      "I attached desktop and mobile screenshots when the browser supports file attachment.",
      "Focus on layout breakage, overlapping text, responsive behavior, accessibility, and concrete fixes.",
      "",
      "Screenshot files:",
      ...params.files.map((file) => `- ${file}`),
    ].join("\n"),
  );
};

const BROWSER_HANDLERS: Record<string, (args: string, ctx: CommandContext) => Promise<void>> = {
  help: showHelpCommand,
  new: runNewCommand,
  stop: stopResponseCommand,
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

const listConversationsCommand = async (args: string, ctx: CommandContext): Promise<void> => {
  const hasArgs = args.trim();
  if (hasArgs) {
    await openMatchingConversation({ query: args.trim(), ctx });
    return;
  }

  const conversations = await ctx.orchestrator.listConversations();

  const isConversationsEmpty = conversations.length === 0;
  if (isConversationsEmpty) {
    console.log("No conversations found in sidebar.");
    return;
  }

  printConversationList(conversations);
};

type OpenMatchingConversationParams = {
  query: string;
  ctx: CommandContext;
};

const openMatchingConversation = async (params: OpenMatchingConversationParams): Promise<void> => {
  const [match] = await params.ctx.orchestrator.searchConversations({
    query: params.query,
    limit: 1,
  });
  const hasMatch = match !== undefined && match !== null;
  if (hasMatch) {
    console.log(`Navigating to: ${match.title} (${match.id})`);
    await params.ctx.orchestrator.navigateToConversation(match.url);
    return;
  }

  console.log(`No conversation matching "${params.query}".`);
};

const printConversationList = (conversations: Array<{ id: string; title: string }>): void => {
  console.log("\nChatGPT Conversations:\n");
  conversations.forEach((conversation, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${conversation.title}`);
  });
  console.log("\nUse /resume <number> to continue a conversation.\n");
};

const listSessionsCommand = async (_args: string, ctx: CommandContext): Promise<void> => {
  const sessions = await listSessions(readSessionStore(ctx.config.repoPath));

  const isSessionsEmpty = sessions.length === 0;
  if (isSessionsEmpty) {
    console.log("No local bridge sessions found.");
    return;
  }

  printSessionRows({ sessions, currentId: ctx.session?.getId() });
};

type PrintSessionRowsParams = {
  sessions: Array<{ id: string; updatedAt: string; model?: string | null; repoPath: string }>;
  currentId?: string;
};

const printSessionRows = (params: PrintSessionRowsParams): void => {
  console.log("\nLocal sessions:\n");
  for (const session of params.sessions.slice(0, 20)) {
    const marker = session.id === params.currentId ? "*" : " ";
    console.log(
      `${marker} ${session.id.padEnd(38)} ${session.updatedAt} ${readSessionModelLabel(session.model)} ${session.repoPath}`,
    );
  }
  console.log("\nUse /resume --last or /resume <session-id> to make a session current.\n");
};

const resumeSessionCommand = async (args: string, ctx: CommandContext): Promise<void> => {
  const query = args.trim();
  const isQueryBlank = query === undefined || query === "";
  if (isQueryBlank) {
    console.log(
      "Usage: /resume <number|title|id> or /resume --last (use /conversations or /sessions)",
    );
    return;
  }

  const isQueryLast = query === "--last";
  if (isQueryLast) {
    await resumeLatestSession(ctx);
    return;
  }

  const isSessionResumed = await resumeLocalSession({ query, ctx });
  if (isSessionResumed) return;

  await resumeBrowserConversation({ query, ctx });
};

const resumeLatestSession = async (ctx: CommandContext): Promise<void> => {
  const latest = await getLatestSession(readSessionStore(ctx.config.repoPath));
  const isLatestMissing = latest == null;
  if (isLatestMissing) {
    console.log("No local bridge sessions found.");
    return;
  }

  await ctx.session?.setId(latest.metadata.id);
  console.log(createSessionSummary(latest.metadata, ctx.session?.getId()));
};

type ResumeLocalSessionParams = {
  query: string;
  ctx: CommandContext;
};

const resumeLocalSession = async (params: ResumeLocalSessionParams): Promise<boolean> => {
  const localSession = await tryLoadSession({
    sessionId: params.query,
    options: readSessionStore(params.ctx.config.repoPath),
  });
  const isLocalSessionMissing = localSession == null;
  if (isLocalSessionMissing) return false;

  await params.ctx.session?.setId(localSession.metadata.id);
  console.log(createSessionSummary(localSession.metadata, params.ctx.session?.getId()));
  return true;
};

type ResumeBrowserConversationParams = {
  query: string;
  ctx: CommandContext;
};

const resumeBrowserConversation = async (
  params: ResumeBrowserConversationParams,
): Promise<void> => {
  const target = await findBrowserConversation({ ctx: params.ctx, query: params.query });
  const isTargetEmpty = !target;
  if (isTargetEmpty) {
    console.log(`No conversation matching "${params.query}". Use /conversations to see the list.`);
    return;
  }

  console.log(`Resuming: ${target.title}`);
  await params.ctx.orchestrator.navigateToConversation(target.url);
};

const findBrowserConversation = async (input: {
  ctx: CommandContext;
  query: string;
}): Promise<{ id: string; title: string; url: string } | undefined> => {
  const num = Number.parseInt(input.query, 10);
  const isNumNaN = Number.isNaN(num);
  if (isNumNaN) {
    const [match] = await input.ctx.orchestrator.searchConversations({
      query: input.query,
      limit: 1,
    });
    return match;
  }

  const conversations = await input.ctx.orchestrator.listConversations();
  return conversations[num - 1];
};

const showTranscriptCommand = async (args: string, ctx: CommandContext): Promise<void> => {
  const sessionId = await readRequestedOrCurrentSessionId({ args, ctx });
  const isSessionIdEmpty = !sessionId;
  if (isSessionIdEmpty) {
    console.log("No local session selected. Use /sessions first.");
    return;
  }

  const exported = await exportSession(sessionId, readSessionStore(ctx.config.repoPath));
  console.log(trimOutput(exported.transcript || "(empty transcript)", 40_000));
};

const copyTranscriptCommand = async (args: string, ctx: CommandContext): Promise<void> => {
  const sessionId = await readRequestedOrCurrentSessionId({ args, ctx });
  const isSessionIdEmpty = !sessionId;
  if (isSessionIdEmpty) {
    console.log("No local session selected. Use /sessions first.");
    return;
  }

  const exported = await exportSession(sessionId, readSessionStore(ctx.config.repoPath));
  await copyTextToClipboard(exported.transcript);
  console.log(`Copied transcript for ${sessionId} to clipboard.`);
};

const exportTranscriptCommand = async (args: string, ctx: CommandContext): Promise<void> => {
  const selection = await readSessionExportFromArgs({ args, ctx });

  const isSelectionSessionIdEmpty = !selection.sessionId;
  if (isSelectionSessionIdEmpty) {
    console.log("No local session selected. Use /sessions first.");
    return;
  }

  await writeSessionExport({
    sessionId: selection.sessionId,
    outputPath: selection.outputPath,
    ctx,
  });
};

type WriteSessionExportParams = {
  sessionId: string;
  outputPath?: string;
  ctx: CommandContext;
};

const writeSessionExport = async (params: WriteSessionExportParams): Promise<void> => {
  const store = readSessionStore(params.ctx.config.repoPath);
  const exported = await exportSession(params.sessionId, store);
  const targetPath =
    params.outputPath === undefined
      ? readDefaultExportPath({ repoPath: params.ctx.config.repoPath, sessionId: params.sessionId })
      : params.outputPath;
  await persistSessionExport({ targetPath, exported, sessionId: params.sessionId });
};

const persistSessionExport = async (input: {
  targetPath: string;
  exported: Awaited<ReturnType<typeof exportSession>>;
  sessionId: string;
}): Promise<void> => {
  const content = exportContentForPath({ path: input.targetPath, exported: input.exported });
  await mkdir(dirname(input.targetPath), { recursive: true });
  await writeFile(input.targetPath, content, "utf-8");
  console.log(`Exported ${input.sessionId} to ${input.targetPath}`);
};

const listCheckpointsCommand = async (_args: string, ctx: CommandContext): Promise<void> => {
  const checkpoints = await listCheckpoints({ repoRoot: ctx.config.repoPath });

  const isCheckpointsEmpty = checkpoints.length === 0;
  if (isCheckpointsEmpty) {
    console.log("No checkpoints found.");
    return;
  }

  printCheckpointRows(checkpoints);
};

const printCheckpointRows = (
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
  const isLabelMissing = label === undefined;
  if (isLabelMissing) return "";

  return label;
};

const restoreCheckpointCommand = async (args: string, ctx: CommandContext): Promise<void> => {
  const parts = splitArgs(args);

  const checkpointId = parts[0];
  const isCheckpointIdEmpty = !checkpointId;
  if (isCheckpointIdEmpty) {
    console.log("Usage: /restore <checkpoint-id> [path ...]");
    return;
  }

  const restored = await restoreCheckpoint({
    repoRoot: ctx.config.repoPath,
    checkpointId,
    paths: parts.slice(1),
  });
  console.log(
    `Restored checkpoint ${checkpointId}: ${restored.restored.length} restored, ${restored.removed.length} removed.`,
  );
};

const runRewindPromptCommand = async (args: string, ctx: CommandContext): Promise<void> => {
  const parts = splitArgs(args);
  if (parts[0] === "--files" || parts[0] === "--both") {
    await rewindWithCheckpoint({ mode: parts[0], parts, ctx });
    return;
  }

  const replacement = args.trim() || undefined;
  await ctx.orchestrator.rewindLastPrompt(replacement);
  console.log(replacement ? "Rewound with replacement prompt." : "Rewound the last prompt.");
};

type RewindWithCheckpointParams = {
  mode: string;
  parts: string[];
  ctx: CommandContext;
};

const rewindWithCheckpoint = async (params: RewindWithCheckpointParams): Promise<void> => {
  const checkpointId = params.parts[1];
  const isCheckpointIdEmpty = !checkpointId;
  if (isCheckpointIdEmpty) {
    console.log(`Usage: /rewind ${params.mode} <checkpoint-id> [replacement prompt]`);
    return;
  }

  await restoreAndMaybeRewind(params, checkpointId);
};

const restoreAndMaybeRewind = async (
  params: RewindWithCheckpointParams,
  checkpointId: string,
): Promise<void> => {
  const restored = await restoreCheckpoint({ repoRoot: params.ctx.config.repoPath, checkpointId });
  console.log(
    `Restored checkpoint ${checkpointId}: ${restored.restored.length} restored, ${restored.removed.length} removed.`,
  );

  const isModeFiles = params.mode === "--files";
  if (isModeFiles) return;

  await rewindPromptAfterRestore(params);
};

const rewindPromptAfterRestore = async (params: RewindWithCheckpointParams): Promise<void> => {
  const replacement = params.parts.slice(2).join(" ").trim() || undefined;
  await params.ctx.orchestrator.rewindLastPrompt(replacement);
  console.log(
    replacement
      ? "Restored files and rewound with replacement prompt."
      : "Restored files and rewound the last prompt.",
  );
};

const SESSION_HANDLERS: Record<string, (args: string, ctx: CommandContext) => Promise<void>> = {
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

const isProviderMissingMcpConnector = (ctx: CommandContext): boolean => {
  return !readProvider(ctx.config.provider).supportsMcpConnector;
};

const showMcpCommand = async (_args: string, ctx: CommandContext): Promise<void> => {
  const isMcpConnectorMissing = isProviderMissingMcpConnector(ctx);
  if (isMcpConnectorMissing) {
    printNoMcpDiagnostics(ctx);
    return;
  }

  console.log(createMcpDiagnostics(ctx));
};

const printNoMcpDiagnostics = (ctx: CommandContext): void => {
  const label = readProviderDisplayName(readProviderIdFrom(ctx.config.provider));
  console.log(
    [
      "MCP bridge diagnostics:",
      `Provider: ${label} web`,
      `Local MCP tools are not available in the ${label} web UI.`,
      "Use @file mentions to inline repo files into prompts.",
      "",
      "For full MCP tools, run with --provider chatgpt, claude, or grok.",
    ].join("\n"),
  );
};

const openConnectorCommand = async (_args: string, ctx: CommandContext): Promise<void> => {
  const isMcpConnectorMissing = isProviderMissingMcpConnector(ctx);
  if (isMcpConnectorMissing) {
    printNoConnectorWarning(ctx);
    return;
  }

  const connector = readMcpConnectorUrl(ctx.config.tunnelUrl);
  const isConnectorEmpty = !connector;
  if (isConnectorEmpty) {
    printMissingConnectorUrl(ctx);
    return;
  }

  await openConnectorSetup({ connector, ctx });
};

const printNoConnectorWarning = (ctx: CommandContext): void => {
  const label = readProviderDisplayName(readProviderIdFrom(ctx.config.provider));
  console.log(
    `${label} web has no custom MCP connector UI. Use @file mentions for read-only repo context, or run with --provider chatgpt, claude, or grok for full MCP tools.`,
  );
};

const printMissingConnectorUrl = (ctx: CommandContext): void => {
  console.log(
    [
      "No public connector URL is available.",
      `Local MCP server: http://localhost:${ctx.config.mcpPort}`,
      "ChatGPT cannot normally reach localhost from the browser connector.",
      "Restart the bridge and fix Cloudflare Tunnel, then run /connector again.",
    ].join("\n"),
  );
};

const openConnectorSetup = async (params: {
  connector: string;
  ctx: CommandContext;
}): Promise<void> => {
  console.log(createMcpDiagnostics(params.ctx));

  if (!params.ctx.orchestrator.openConnectorSetup) {
    console.log(
      "\nBrowser setup automation is unavailable. Open ChatGPT Settings -> Apps -> Advanced settings -> Create app and paste the Connector URL.",
    );
    return;
  }

  const setupResult = await params.ctx.orchestrator.openConnectorSetup({
    connectorUrl: params.connector,
  });
  console.log(createConnectorSetupResult(setupResult));
};

const runPermissionsCommand = async (args: string, ctx: CommandContext): Promise<void> => {
  const next = args.trim();
  const isNextEmpty = !next;
  if (isNextEmpty) {
    printPermissionModes(ctx);
    return;
  }

  await setPermissionMode({ next, ctx });
};

const printPermissionModes = (ctx: CommandContext): void => {
  console.log(`Permission mode: ${readStatusPermissionLabel(ctx)}`);
  console.log(`Available: ${PERMISSION_MODES.join(", ")}`);
};

const setPermissionMode = async (params: { next: string; ctx: CommandContext }): Promise<void> => {
  const mode = normalizePermissionMode(params.next);
  const isNextModeDifferent = mode !== params.next;
  if (isNextModeDifferent) {
    console.log(
      `Unknown permission mode "${params.next}". Available: ${PERMISSION_MODES.join(", ")}`,
    );
    return;
  }

  await params.ctx.permission?.setMode(mode);
  params.ctx.config.permissionMode = mode;
  console.log(`Permission mode set to ${mode}.`);
};

const runTaskCommand = async (args: string, ctx: CommandContext): Promise<void> => {
  const task = args.trim();
  const isTaskEmpty = task === "";
  if (isTaskEmpty) {
    console.log("Usage: /task <project task>");
    return;
  }

  const isMcpConnectorMissing = isProviderMissingMcpConnector(ctx);
  if (isMcpConnectorMissing) {
    printNoMcpTaskWarning(ctx);
    return;
  }

  const instructions = await loadProjectInstructions(ctx.config.repoPath);
  await ctx.sendMessage(
    createProjectTaskPromptWithInstructions(task, ctx, instructions.promptText),
  );
};

const printNoMcpTaskWarning = (ctx: CommandContext): void => {
  const label = readProviderDisplayName(readProviderIdFrom(ctx.config.provider));
  console.log(
    `${label} web does not support MCP connectors. /task needs live repo tools — use --provider chatgpt, claude, or grok, or send a normal prompt with @file mentions.`,
  );
};

const runReviewCommand = async (args: string, ctx: CommandContext): Promise<void> => {
  const scope = args.trim() || "working";
  await ctx.sendMessage(
    [
      "Review the local repository changes with a code-review stance.",
      "Prioritize bugs, regressions, security risks, and missing tests.",
      "Use the MCP tools to inspect the repo and diff before making claims.",
      `Review scope: ${scope}`,
    ].join("\n"),
  );
};

const MCP_HANDLERS: Record<string, (args: string, ctx: CommandContext) => Promise<void>> = {
  task: runTaskCommand,
  permissions: runPermissionsCommand,
  mcp: showMcpCommand,
  connector: openConnectorCommand,
  review: runReviewCommand,
};

const runModelCommand = async (args: string, ctx: CommandContext): Promise<void> => {
  const query = args.trim();
  if (query) {
    await switchModel({ query, ctx });
    return;
  }

  await showCurrentModel(ctx);
};

const switchModel = async (params: { query: string; ctx: CommandContext }): Promise<void> => {
  const model = await params.ctx.orchestrator.switchModel(params.query);
  params.ctx.counter.setModel(model);
  const profile = findModelProfile(model);
  console.log(
    `Model switched to ${model}. Context estimate now uses ${profile.contextWindow.toLocaleString()} tokens.`,
  );
};

const showCurrentModel = async (ctx: CommandContext): Promise<void> => {
  const current = await ctx.orchestrator.detectModel();
  ctx.counter.setModel(current);
  printModelProfile(current);
  await printAvailableModels(ctx);
};

const printAvailableModels = async (ctx: CommandContext): Promise<void> => {
  const available = await ctx.orchestrator.listModels();

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
    console.log(`  ${model.selected ? "*" : " "} ${model.label}`);
  }
  console.log("\nUse /model <name> to switch.");
};

const printKnownProfiles = (): void => {
  console.log("\nKnown context profiles:");
  for (const model of listModelProfiles()) {
    console.log(`  ${model.label.padEnd(24)} ${model.contextWindow.toLocaleString()} ctx`);
  }
};

const showContextCommand = async (_args: string, ctx: CommandContext): Promise<void> => {
  console.log(`Context estimate for ${ctx.counter.modelLabel}: ${ctx.counter.summary}`);
};

const MODEL_HANDLERS: Record<string, (args: string, ctx: CommandContext) => Promise<void>> = {
  model: runModelCommand,
  context: showContextCommand,
};

const executeBuiltinCommand = async (input: {
  parsed: { name: string; args: string };
  cmd: CommandDef;
  ctx: CommandContext;
}): Promise<boolean> => {
  try {
    await input.cmd.handler(input.parsed.args, input.ctx);
  } catch (err) {
    const isErrorObject = err instanceof Error;
    const message = isErrorObject ? err.message : String(err);
    console.error(`Command /${input.parsed.name} failed: ${message}`);
  }
  return true;
};

const executeCustomCommand = async (input: {
  parsed: { name: string; args: string };
  ctx: CommandContext;
}): Promise<boolean> => {
  const custom = await findCustomCommand({ name: input.parsed.name, ctx: input.ctx });
  const isCustomEmpty = !custom;
  if (isCustomEmpty) return false;

  await input.ctx.sendMessage(renderCustomCommandPrompt(custom, input.parsed.args));
  return true;
};

const parseCommandInput = (input: string): { name: string; args: string } | null => {
  const trimmed = input.trim();
  const isNotSlashCommand = !trimmed.startsWith("/");
  if (isNotSlashCommand) return null;

  const { name, args } = splitCommandNameAndArgs(trimmed);
  const isNameEmpty = !name;
  if (isNameEmpty) return null;

  return { name, args };
};

const splitCommandNameAndArgs = (trimmed: string): { name: string; args: string } => {
  const spaceIndex = trimmed.indexOf(" ");
  const isSpaceNotFound = spaceIndex === -1;
  const name = isSpaceNotFound ? trimmed.slice(1) : trimmed.slice(1, spaceIndex);
  const args = isSpaceNotFound ? "" : trimmed.slice(spaceIndex + 1);
  return { name, args };
};

const findCustomCommand = async (input: { name: string; ctx: CommandContext }) => {
  const custom = await loadCustomCommands({ repoRoot: input.ctx.config.repoPath });
  return custom.find((command) => command.name === input.name);
};

type CommandHandlerMap = Record<string, CommandDef["handler"]>;

type ComposeCommandsInput = {
  meta: CommandMeta[];
  handlers: CommandHandlerMap;
};

const composeCommands = (input: ComposeCommandsInput): CommandDef[] => {
  return input.meta.flatMap((entry) => {
    const handler = input.handlers[entry.name];
    const isHandlerMissing = handler == null;
    if (isHandlerMissing) return [];

    return [{ name: entry.name, description: entry.description, aliases: entry.aliases, handler }];
  });
};

const BUILTIN_COMMANDS: CommandDef[] = [
  filesCommand,
  ...composeCommands({ meta: SESSION_COMMANDS, handlers: SESSION_HANDLERS }),
  ...composeCommands({ meta: MODEL_COMMANDS, handlers: MODEL_HANDLERS }),
  ...composeCommands({ meta: MCP_COMMANDS, handlers: MCP_HANDLERS }),
  ...composeCommands({ meta: BROWSER_COMMANDS, handlers: BROWSER_HANDLERS }),
];

const commands = new Map<string, CommandDef>();
const canonicalNames = new Set<string>();

const registerCommand = (cmd: CommandDef): void => {
  commands.set(cmd.name, cmd);
  canonicalNames.add(cmd.name);
  const aliases = cmd.aliases === undefined ? [] : cmd.aliases;
  for (const alias of aliases) {
    commands.set(alias, cmd);
  }
};

export const listRegisteredCommands = (): CommandDef[] => {
  const listed: CommandDef[] = [];
  for (const name of canonicalNames) {
    const command = commands.get(name);

    const isCommandMissing = command === undefined;
    if (isCommandMissing) continue;

    if (command.hidden) continue;

    listed.push(command);
  }
  return listed;
};

// Built-in first; else project/user markdown templates. Handler errors stay non-throwing for the TUI.
export const executeCommand = async (input: string, ctx: CommandContext): Promise<boolean> => {
  const parsed = parseCommandInput(input);
  const isParsedEmpty = !parsed;
  if (isParsedEmpty) return false;

  const cmd = commands.get(parsed.name);
  const isCmdMissing = cmd == null;
  if (isCmdMissing) return executeCustomCommand({ parsed, ctx });

  return executeBuiltinCommand({ parsed, cmd, ctx });
};

export const matchCommands = (partial: string): CommandDef[] => {
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
  await Promise.allSettled([engine.getOrchestrator().stopResponse()]);
  await Promise.allSettled([engine.shutdown({ closeBrowser: false })]);
};

export const runSessions = async (): Promise<void> => {
  const sessions = await listSessions();
  process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
};

export const runBrowserStatus = async (options: BrowserStatusOptions = {}): Promise<void> => {
  const status = await readBrowserStatus();

  if (options.json) process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  else process.stdout.write(`${createBrowserDebugStatus(status)}\n`);
};

const cacheProfileRoot = (options: CacheCmdOptions): string => {
  return options.profile ? resolve(options.profile) : bridgeChromeProfileRoot();
};

export const runCacheList = async (options: CacheCmdOptions): Promise<void> => {
  const inventory = await inventoryChromeCache({
    profileRoot: cacheProfileRoot(options),
  });

  if (options.json) process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
  else process.stdout.write(`${createCacheInventory(inventory)}\n`);
};

export const runCachePrune = async (options: CacheCmdOptions): Promise<void> => {
  const dryRun = options.dryRun === undefined ? !options.yes : options.dryRun;
  const isNotDryRun = !dryRun;
  if (isNotDryRun) await assertChromeClosedForCachePrune();

  const pruneResult = await pruneChromeCache({
    profileRoot: cacheProfileRoot(options),
    dryRun,
    confirm: options.yes,
  });

  if (options.json) process.stdout.write(`${JSON.stringify(pruneResult, null, 2)}\n`);
  else process.stdout.write(`${createCachePruneResult(pruneResult)}\n`);
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
    await engine.shutdown({ closeBrowser: false });
    return fail(
      `Browser not connected. Run \`bridge chrome start --provider ${provider}\` and sign in if needed.`,
    );
  }

  try {
    await browserProvider.assertSignedIn(browser.getPage());
  } catch (err) {
    await engine.shutdown({ closeBrowser: false });
    const isErrorObject = err instanceof Error;
    fail(isErrorObject ? err.message : String(err));
  }
};

type AskedChat = { conversationId: string | null; url: string };

type WriteAskOutputContext = {
  engine: Awaited<ReturnType<typeof startEngine>>;
  askedChat: AskedChat;
  reply: Awaited<ReturnType<Awaited<ReturnType<typeof startEngine>>["ask"]>>;
  orchestratorError: string | null;
  options: AskOptions;
  provider: ReturnType<typeof readProviderIdFrom>;
  displayName: string;
};

// Prefer the real orchestrator error over a generic "not logged in" hint.
const writeAskOutput = (ctx: WriteAskOutputContext): void => {
  if (!ctx.reply) {
    const fallbackHint = `No reply captured — ${ctx.displayName} may not be logged in, or the page UI changed. Try \`bridge chrome start --provider ${ctx.provider}\`.`;
    fail(ctx.orchestratorError === null ? fallbackHint : ctx.orchestratorError);
    return;
  }

  if (ctx.options.json) {
    process.stdout.write(
      `${JSON.stringify({
        sessionId: ctx.engine.sessionId,
        model: ctx.engine.getOrchestrator().model,
        reply: ctx.reply.content,
        contextTokens: ctx.engine.counter.count,
        conversationId: ctx.askedChat.conversationId,
        url: ctx.askedChat.url,
      })}\n`,
    );
    return;
  }

  process.stdout.write(`${ctx.reply.content}\n`);
};

type StartAskEngineInput = {
  options: AskOptions;
  provider: ReturnType<typeof readProviderIdFrom>;
  supportsMcpConnector: boolean;
};

const runAskFlow = async (input: { prompt: string; options: AskOptions }): Promise<void> => {
  if (input.options.fanOut) return fanOutFromOptions(input.options);

  const isPromptBlank = !input.prompt.trim();
  if (isPromptBlank) {
    return failUsage('Provide a prompt (e.g. `bridge ask "hi"`) or a task file via --fan-out.');
  }

  const providers = listProvidersOrFail(input.options.provider);
  const hasManyProviders = providers.length > 1;
  if (hasManyProviders) {
    return fanOutPromptAcrossProviders({
      prompt: input.prompt,
      providers,
      options: input.options,
    });
  }

  const setup = await prepareAskRun(input.options);
  const captured = captureOrchestratorError(setup.engine);
  const reply = await askEngineTurn({
    engine: setup.engine,
    prompt: input.prompt,
    options: input.options,
  });
  await finishAskRun({
    setup,
    reply,
    orchestratorError: captured.lastError(),
    options: input.options,
  });
};

const listProvidersOrFail = (spec: string | undefined): BridgeProviderId[] => {
  try {
    return listProviderIdsFrom(spec);
  } catch (err) {
    const isErrorObject = err instanceof Error;
    return fail(isErrorObject ? err.message : String(err));
  }
};

const fanOutPromptAcrossProviders = async (input: {
  prompt: string;
  providers: BridgeProviderId[];
  options: AskOptions;
}): Promise<void> => {
  const tasks: FanoutTask[] = input.providers.map((provider) => ({
    prompt: input.prompt,
    provider,
  }));
  await fanOutAndReport({
    tasks,
    provider: input.providers[0] === undefined ? DEFAULT_PROVIDER : input.providers[0],
    options: input.options,
  });
};

const fanOutFromOptions = async (options: AskOptions): Promise<void> => {
  const isFanOutMissing = options.fanOut === undefined;
  const fanOutSpec = isFanOutMissing ? "" : options.fanOut;
  const tasks = await loadFanoutTasks(fanOutSpec);
  await fanOutAndReport({ tasks, provider: readProviderIdFrom(options.provider), options });
};

const readFanoutSource = async (spec: string): Promise<string> => {
  const trimmed = spec.trim();
  const isJsonArrayText = trimmed.startsWith("[");
  if (isJsonArrayText) return trimmed;

  const isAtMentionText = trimmed.startsWith("@");
  const path = isAtMentionText ? trimmed.slice(1) : trimmed;
  const absolute = isAbsolute(path) ? path : resolve(process.cwd(), path);
  return readFile(absolute, "utf8");
};

const loadFanoutTasks = async (spec: string): Promise<readonly FanoutTask[]> => {
  const isSpecBlank = !spec.trim();
  if (isSpecBlank) return failUsage("--fan-out needs a task file, @file, or inline JSON array.");

  const raw = await readFanoutSource(spec).catch((err: unknown) => {
    const isErrorObject = err instanceof Error;
    return fail(`--fan-out could not read ${spec}: ${isErrorObject ? err.message : String(err)}`);
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const isErrorObject = err instanceof Error;
    return failUsage(`--fan-out is not valid JSON: ${isErrorObject ? err.message : String(err)}`);
  }
  try {
    return FanoutTasksSchema.parse(parsed);
  } catch (err) {
    const isInstanceError = err instanceof Error;
    return failUsage(
      `--fan-out does not match the task schema (need a non-empty array of {prompt, provider?, conversation?, label?, isolate?}): ${
        isInstanceError ? err.message : String(err)
      }`,
    );
  }
};

interface FanoutRunInput {
  readonly tasks: readonly FanoutTask[];
  readonly provider: BridgeProviderId;
  readonly options: AskOptions;
}

const fanOutAndReport = async (input: FanoutRunInput): Promise<void> => {
  const engine = await startAskEngine({
    options: { ...input.options, provider: input.provider },
    provider: input.provider,
    supportsMcpConnector: false,
  });

  const isFanoutFailed = await fanOutOnEngine(engine, input);
  if (isFanoutFailed) throw new Error("Some fan-out tasks failed.");
};

// Shuts the engine down once: in the catch on failure, or right after the report on success.
const fanOutOnEngine = async (
  engine: Awaited<ReturnType<typeof startAskEngine>>,
  input: FanoutRunInput,
): Promise<boolean> => {
  try {
    const isEngineBrowserMissing = engine.browser == null;
    if (isEngineBrowserMissing) {
      return fail(
        `Browser not connected. Run \`bridge chrome start --provider ${input.provider}\` and sign in if needed.`,
      );
    }

    const fanoutResult = await fanOutConversations({
      browser: engine.browser,
      config: engine.config,
      tasks: input.tasks,
      manifestRoot: attachmentManifestsDir(),
      options: readFanoutOptionsFromAsk(input.options),
    });
    writeFanoutOutput(fanoutResult, input.options);
    await Promise.allSettled([engine.shutdown({ closeBrowser: false })]);
    return fanoutFailed(fanoutResult, Boolean(input.options.strict));
  } catch (err) {
    await Promise.allSettled([engine.shutdown({ closeBrowser: false })]);
    const isErrorObject = err instanceof Error;
    return fail(isErrorObject ? err.message : String(err));
  }
};

const readPositiveIntegerFromOption = (value: string | undefined): number | undefined => {
  const isOptionValueMissing = value === undefined;
  if (isOptionValueMissing) return undefined;

  const parsed = Number.parseInt(value, 10);
  const isPositiveNumber = Number.isFinite(parsed) && parsed > 0;
  return isPositiveNumber ? parsed : undefined;
};

const readNonNegativeIntegerFromOption = (value: string | undefined): number | undefined => {
  const isOptionValueAbsent = value === undefined;
  if (isOptionValueAbsent) return undefined;

  const parsed = Number.parseInt(value, 10);
  const isNonNegativeNumber = Number.isFinite(parsed) && parsed >= 0;
  return isNonNegativeNumber ? parsed : undefined;
};

const readFanoutOptionsFromAsk = (options: AskOptions): FanoutOptions => {
  const timeoutMs = convertSecondsToTimeoutMilliseconds(options.timeout);
  const maxConcurrency = readPositiveIntegerFromOption(options.maxConcurrency);
  const limit = readPositiveIntegerFromOption(options.limit);
  const offset = readNonNegativeIntegerFromOption(options.offset);
  const maxReplyChars = readPositiveIntegerFromOption(options.maxReplyChars);
  const hasOffset = offset !== undefined;
  return {
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(maxConcurrency ? { maxConcurrency } : {}),
    ...(limit ? { limit } : {}),
    ...(hasOffset ? { offset } : {}),
    ...(maxReplyChars ? { maxReplyChars } : {}),
  };
};

const writeFanoutOutput = (result: FanoutResult, options: AskOptions): void => {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  result.results.forEach((row, index) => {
    const status = row.ok ? "ok" : "error";
    const heading = createFanoutRowHeading({ row, offset: result.offset, index });
    const target = readFanoutTargetLabel(row.target);
    const truncated = row.truncated ? `, truncated from ${row.replyChars}` : "";
    const rowBody = createFanoutRowBody(row);
    process.stdout.write(
      `=== ${heading} (${status}, ${row.elapsedMs}ms${target}${truncated}) ===\n${rowBody}\n\n`,
    );
  });

  if (result.nextOffset !== null) {
    const remaining = result.total - result.offset - result.results.length;
    process.stdout.write(
      `… ${remaining} more task(s). Re-run with --offset ${result.nextOffset}.\n`,
    );
  }
};

const createFanoutRowHeading = (input: {
  row: FanoutResult["results"][number];
  offset: number;
  index: number;
}): string => {
  if (input.row.label !== undefined && input.row.label !== "") return input.row.label;

  return `task ${input.offset + input.index + 1}`;
};

const readFanoutTargetLabel = (target: FanoutResult["results"][number]["target"]): string => {
  const isTargetMissing = target === null;
  if (isTargetMissing) return "";

  if (target.id === null || target.id === "") return ` ${target.provider}`;

  return ` ${target.provider} ${target.id}`;
};

const createFanoutRowBody = (row: FanoutResult["results"][number]): string => {
  if (row.ok) {
    if (row.reply === undefined) return "";

    return row.reply;
  }

  if (row.error === undefined) return "";

  return row.error;
};

const readFanOutForServe = async (
  tasks: FanoutTask[],
  batchOptions: FanoutOptions,
  base: AskOptions,
): Promise<FanoutResult> => {
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
      manifestRoot: attachmentManifestsDir(),
      options: batchOptions,
    });
  } finally {
    await Promise.allSettled([engine.shutdown({ closeBrowser: false })]);
  }
};

// stdout is JSON-RPC; engine/browser logs must not write there.
export const runServe = async (options: ServeOptions): Promise<void> => {
  const base: AskOptions = { repo: options.repo, port: options.port, timeout: options.timeout };
  const deps: AskGatewayDeps = {
    repoRoot: repositoryRoot(options.repo),
    fanOut: (tasks, opts) => readFanOutForServe(tasks, opts, base),
    searchConversations: (providers, query, opts) => {
      const providerIds = providers.map((provider) => providerIdFrom(provider));

      return readFanoutConversationSearch({
        providers: providerIds,
        query,
        options: base,
        searchOptions: opts,
      });
    },
    // Each flow_* tool call attaches to the warm browser, drives the Flow page, then
    // shuts the engine down keeping the browser open — mirroring the per-call lifecycle
    // the fan-out `ask` path uses. See the `bridge flow …` CLI runners.
    withFlowPage: async (op) => {
      const { engine, page } = await startFlowSession({ repo: options.repo, port: options.port });
      try {
        return await op(page);
      } finally {
        await Promise.allSettled([engine.shutdown({ closeBrowser: false })]);
      }
    },
    // Each chatgpt_* recon tool attaches to the warm browser, reads the ChatGPT page, then
    // shuts the engine down keeping the browser open — mirroring withFlowPage. See the
    // `bridge chatgpt …` CLI runners.
    withDesignPage: (op) => runWithDesignPage({ repo: options.repo, port: options.port }, op),
    withChatGptPage: async (op) => {
      const { engine, page } = await startWorkspaceSession({
        repo: options.repo,
        port: options.port,
      });
      try {
        return await op(page);
      } finally {
        await Promise.allSettled([engine.shutdown({ closeBrowser: false })]);
      }
    },
  };
  await serveAskGatewayStdio(deps);
};

type ConversationSearchOutcome = {
  ok: boolean;
  results?: ConversationSearchResult[];
  error?: string;
  elapsedMs: number;
};

interface ReadFanoutConversationSearchDetails {
  providers: BridgeProviderId[];
  query: string;
  options: AskOptions;
  searchOptions?: { limit?: number };
}

const readFanoutConversationSearch = async ({
  providers,
  query,
  options,
  searchOptions = {},
}: ReadFanoutConversationSearchDetails): Promise<Record<string, ConversationSearchOutcome>> => {
  const outcomes = await Promise.all(
    providers.map(async (provider): Promise<readonly [string, ConversationSearchOutcome]> => {
      const started = Date.now();
      try {
        const searchResults = await searchOneProvider({ provider, query, options, searchOptions });
        return [provider, { ok: true, results: searchResults, elapsedMs: Date.now() - started }];
      } catch (err) {
        const isErrorObject = err instanceof Error;
        const error = isErrorObject ? err.message : String(err);
        return [provider, { ok: false, error, elapsedMs: Date.now() - started }];
      }
    }),
  );
  return Object.fromEntries(outcomes);
};

interface SearchOneProviderDetails {
  provider: BridgeProviderId;
  query: string;
  options: AskOptions;
  searchOptions: { limit?: number };
}

const searchOneProvider = async ({
  provider,
  query,
  options,
  searchOptions,
}: SearchOneProviderDetails): Promise<ConversationSearchResult[]> => {
  const browserProvider = readProvider(provider);
  const engine = await startAskEngine({
    options: { ...options, provider },
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
      limit: searchOptions.limit,
    });
  } finally {
    await Promise.allSettled([engine.shutdown({ closeBrowser: false })]);
  }
};

// Capture orchestrator errors so a null reply can report the real failure.
const captureOrchestratorError = (
  engine: Awaited<ReturnType<typeof startEngine>>,
): {
  lastError: () => string | null;
} => {
  let lastError: string | null = null;
  engine.getOrchestrator().on((event) => {
    const isEventTypeError = event.type === "error";
    if (isEventTypeError) lastError = event.error;
  });
  return { lastError: () => lastError };
};

const prepareAskRun = async (options: AskOptions) => {
  const providers = pickAskProvider(options);
  const engine = await startAskEngine({
    options,
    provider: providers.provider,
    supportsMcpConnector: providers.browserProvider.supportsMcpConnector,
  });
  addStopOnInterrupt(() => stopEngine(engine));
  await assertSignedIn(engine, providers.browserProvider, providers.provider);
  return { engine, ...providers };
};

const pickAskProvider = (options: AskOptions) => {
  const provider = readProviderIdFrom(options.provider);
  return { provider, browserProvider: readProvider(provider) };
};

const finishAskRun = async (input: {
  setup: Awaited<ReturnType<typeof prepareAskRun>>;
  reply: Awaited<ReturnType<Awaited<ReturnType<typeof startEngine>>["ask"]>>;
  orchestratorError: string | null;
  options: AskOptions;
}): Promise<void> => {
  const askedChat = readAskedChat(input.setup);
  await input.setup.engine.shutdown({ closeBrowser: false });
  writeAskOutput({
    engine: input.setup.engine,
    askedChat,
    reply: input.reply,
    orchestratorError: input.orchestratorError,
    options: input.options,
    provider: input.setup.provider,
    displayName: input.setup.browserProvider.displayName,
  });
};

const readAskedChat = (setup: Awaited<ReturnType<typeof prepareAskRun>>): AskedChat => {
  const url = requireBrowserPage(setup.engine).url();
  const conversationId = readConversationIdForProviderUrl({ providerId: setup.provider, url });
  return { conversationId, url };
};

const startAskEngine = async (input: StartAskEngineInput) => {
  const withTools = Boolean(input.options.tools) && input.supportsMcpConnector;
  return startEngine({
    repoPath: input.options.repo ? resolve(input.options.repo) : undefined,
    provider: input.provider,
    mcpPort: parsePortFlag("--port", input.options.port),
    withBrowser: true,
    withTools,
    persist: withTools,
    debugPort: parsePortFlag("--debug-port", input.options.debugPort),
    profileRoot: readProfileRootFromOption(input.options.profile),
  });
};

const readImageCountFromOption = (value: string | undefined): number | undefined => {
  const isOptionValueUnset = value === undefined;
  if (isOptionValueUnset) return undefined;

  const parsed = Number.parseInt(value, 10);
  const isPositiveNumber = Number.isFinite(parsed) && parsed > 0;
  return isPositiveNumber ? parsed : undefined;
};

const LOWEST_PORT = 1;
const HIGHEST_PORT = 65535;

const parsePortFlag = (flagName: string, portText: string | undefined): number | undefined => {
  const isPortMissing = portText === undefined || portText === "";
  if (isPortMissing) return undefined;

  const port = Number(portText);

  const isPortValid = /^\d+$/.test(portText) && port >= LOWEST_PORT && port <= HIGHEST_PORT;
  if (isPortValid) return port;

  throw new Error(`${flagName} must be a whole number from ${LOWEST_PORT} to ${HIGHEST_PORT}.`);
};

const readProfileRootFromOption = (value: string | undefined): string | undefined => {
  return value ? resolve(value) : undefined;
};

const askEngineTurn = async (input: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  prompt: string;
  options: AskOptions;
}) => {
  await applyAskPreflight({ engine: input.engine, options: input.options });
  await attachAskFiles({ engine: input.engine, options: input.options });
  return input.engine.ask({
    content: input.prompt,
    timeoutMs: convertSecondsToTimeoutMilliseconds(input.options.timeout),
    expectImages: readImageCountFromOption(input.options.images),
  });
};

const attachAskFiles = async (input: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  options: AskOptions;
}): Promise<void> => {
  // Runs even without --attach, so files left in the composer by a failed ask never ride along.
  const paths = input.options.attach ?? [];
  const repoRoot = input.engine.config.repoPath;
  const resolved = paths.map((target) => {
    const rel = createRepositoryFilePath({ repoRoot, input: target });
    assertImagePath(rel);
    return resolve(repoRoot, rel);
  });
  await input.engine.getOrchestrator().attachFiles(resolved);
};

const readConversationUrlFromOption = (value: string): string => {
  return readChatGptConversationUrlFromIdOrUrl(value);
};

export const readConversationIdFromOption = (value: string): string => {
  const conversationUrl = readConversationUrlFromOption(value);
  const conversationId = readChatGptConversationIdFromUrl(conversationUrl);

  const isNotChatUrl = conversationId === null;
  if (isNotChatUrl) throw new Error(`Not a ChatGPT chat id or URL: ${value}`);

  return conversationId;
};

const navigateToConversationIfNeeded = async (input: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  conversation?: string;
  page: Page;
}): Promise<void> => {
  if (!input.conversation) return;

  const targetUrl = readConversationUrlFromOption(input.conversation);
  if (isSameChatGptConversation(input.page.url(), targetUrl)) return;

  await Promise.allSettled([input.engine.getOrchestrator().navigateToConversation(targetUrl)]);
};

export const applyAskPreflight = async (input: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  options: AskOptions;
}): Promise<void> => {
  if (input.options.fresh)
    await Promise.allSettled([input.engine.getOrchestrator().newConversation()]);
  else if (input.options.conversation) {
    await Promise.allSettled([
      input.engine
        .getOrchestrator()
        .navigateToConversation(readConversationUrlFromOption(input.options.conversation)),
    ]);
  }

  const isModelEmpty = !input.options.model;
  if (isModelEmpty) return;

  try {
    await input.engine.getOrchestrator().switchModel(input.options.model);
  } catch (error) {
    const isErrorObject = error instanceof Error;
    const reason = isErrorObject ? error.message : String(error);
    throw new Error(`Could not switch to model "${input.options.model}": ${reason}`);
  }
};

const assertDownloadProviderSupported = (options: DownloadCmdOptions): void => {
  const isGeminiProvider = readProviderIdFrom(options.provider) === "gemini";
  if (isGeminiProvider) {
    fail("Attachment download is not supported for Gemini web yet. Use ChatGPT for /download.");
  }
};

const downloadConversationAttachments = async (input: {
  page: Page;
  conversationId: string;
  repoRoot: string;
  options: DownloadCmdOptions;
  manifestRoot: string;
}): Promise<DownloadResult[]> => {
  const ids = parseAttachmentIds(input.options.id);
  return downloadAll(input.page, input.conversationId, {
    repoRoot: input.repoRoot,
    manifestRoot: input.manifestRoot,
    ...(input.options.out ? { outDir: input.options.out } : {}),
    ...(ids ? { ids } : {}),
  });
};

const writeDownloadOutput = (results: DownloadResult[], json?: boolean): void => {
  if (json) {
    process.stdout.write(`${JSON.stringify(results)}\n`);
    return;
  }

  for (const download of results) {
    const line = `${createDownloadLine(download)}
`;

    if (download.error) process.stderr.write(line);
    else process.stdout.write(line);
  }
};

export const parseAttachmentIds = (values: readonly string[] | undefined): string[] | undefined => {
  if (!values) return undefined;

  const ids = values
    .flatMap((value) => value.split(/[\s,]+/))
    .map((id) => id.trim())
    .filter(Boolean);
  const isIdsNotEmpty = ids.length > 0;
  return isIdsNotEmpty ? ids : undefined;
};

export const createDownloadLine = (result: DownloadResult): string => {
  const isIdBlank = result.id === undefined || result.id === "";
  const label = isIdBlank ? "attachment" : result.id;

  const hasError = result.error !== undefined;
  if (hasError) return `${label}: ${result.error}`;

  return `${label} -> ${result.path} (${result.bytes} bytes)`;
};

export const runDownload = async (options: DownloadCmdOptions): Promise<void> => {
  assertDownloadProviderSupported(options);
  const results = await runDownloadFlow(options);
  writeDownloadOutput(results, options.json);
};

const runDownloadFlow = async (options: DownloadCmdOptions): Promise<DownloadResult[]> => {
  const context = await prepareDownloadContext(options);
  const results = await downloadAfterExtract(context);
  await context.engine.shutdown({ closeBrowser: false });
  return results;
};

const prepareDownloadContext = async (options: DownloadCmdOptions) => {
  const engine = await startDownloadEngine(options);
  const page = requireBrowserPage(engine);
  return {
    engine,
    page,
    conversationId: downloadConversationId({ page, conversation: options.conversation }),
    options,
  };
};

const downloadConversationId = (input: {
  page: Page;
  conversation: string | undefined;
}): string => {
  const { page, conversation } = input;

  const isNotConversationGiven = conversation === undefined;
  if (isNotConversationGiven) return readConversationIdFromPage(page);

  return readConversationIdFromOption(conversation);
};

const downloadAfterExtract = async (input: {
  page: Page;
  conversationId: string;
  options: DownloadCmdOptions;
  engine: Awaited<ReturnType<typeof startDownloadEngine>>;
}): Promise<DownloadResult[]> => {
  const manifestRoot = attachmentManifestsDir();
  await navigateToConversationIfNeeded({
    engine: input.engine,
    conversation: input.options.conversation,
    page: input.page,
  });
  await extractAllMessages(input.page, { conversationId: input.conversationId, manifestRoot });
  await registerConversationImages({
    page: input.page,
    conversationId: input.conversationId,
    manifestRoot,
  });

  if (input.options.scan) {
    const manifest = await loadManifest(input.conversationId, { manifestRoot });
    process.stderr.write(
      `Manifest refreshed: ${manifest.attachments.length} attachment(s) for ${input.conversationId}\n`,
    );
    return [];
  }

  return downloadConversationAttachments({
    ...input,
    repoRoot: input.engine.config.repoPath,
    manifestRoot,
  });
};

const startDownloadEngine = async (options: DownloadCmdOptions) => {
  return startEngine({
    repoPath: options.repo ? resolve(options.repo) : undefined,
    provider: readProviderIdFrom(options.provider),
    mcpPort: parsePortFlag("--port", options.port),
    withBrowser: true,
    withTools: false,
    persist: false,
    debugPort: parsePortFlag("--debug-port", options.debugPort),
    profileRoot: readProfileRootFromOption(options.profile),
  });
};

const requireBrowserPage = (engine: Awaited<ReturnType<typeof startEngine>>): Page => {
  const browser = engine.browser;
  const isBrowserMissing = browser == null;
  if (isBrowserMissing) {
    void engine.shutdown({ closeBrowser: false });
    return fail(
      "Browser not connected. Run `bridge chrome start` and sign in to ChatGPT if needed.",
    );
  }

  return browser.getPage();
};

const assertChatgptWorkspace = (options: CliOptions): void => {
  const isNotChatGptProvider = readProviderIdFrom(options.provider) !== "chatgpt";
  if (isNotChatGptProvider) {
    fail(
      "Projects, chat moves, and Scheduled tasks are ChatGPT-only. Omit --provider or pass --provider chatgpt.",
    );
  }
};

const startWorkspaceSession = async (options: CliOptions & BrowserTargetOptions) => {
  const engine = await startEngine({
    repoPath: options.repo ? resolve(options.repo) : undefined,
    provider: "chatgpt",
    mcpPort: parsePortFlag("--port", options.port),
    withBrowser: true,
    withTools: false,
    debugPort: parsePortFlag("--debug-port", options.debugPort),
    profileRoot: readProfileRootFromOption(options.profile),
  });
  return { engine, page: requireBrowserPage(engine) };
};

export const runProjectList = async (options: ProjectCmdOptions): Promise<void> => {
  assertChatgptWorkspace(options);
  const { engine, page } = await startWorkspaceSession(options);
  const projects = await listProjects(page);
  await engine.shutdown({ closeBrowser: false });

  if (options.json) process.stdout.write(`${JSON.stringify(projects)}\n`);
  else if (projects.length === 0) process.stdout.write("No projects.\n");
  else for (const project of projects) process.stdout.write(`${project.name}\n`);
};

export const runProjectCreate = async (name: string, options: ProjectCmdOptions): Promise<void> => {
  assertChatgptWorkspace(options);

  const isNameBlank = !name.trim();
  if (isNameBlank) failUsage("Usage: bridge project create <name>");

  const { engine, page } = await startWorkspaceSession(options);
  const project = await createProject(page, name);
  await engine.shutdown({ closeBrowser: false });

  if (options.json) process.stdout.write(`${JSON.stringify(project)}\n`);
  else process.stdout.write(`Created project: ${project.name}\n`);
};

export const runProjectRename = async (name: string, options: ProjectCmdOptions): Promise<void> => {
  assertChatgptWorkspace(options);

  const to = options.to?.trim();
  const isRenameIncomplete = !name.trim() || !to;
  if (isRenameIncomplete) return failUsage("Usage: bridge project rename <name> --to <newName>");

  const { engine, page } = await startWorkspaceSession(options);
  const outcome = await renameProject(page, { project: name, name: to });
  await engine.shutdown({ closeBrowser: false });

  if (options.json) process.stdout.write(`${JSON.stringify(outcome)}\n`);
  else if (outcome.renamed)
    process.stdout.write(`Renamed "${outcome.project}" -> ${outcome.renamedTo}\n`);
  else process.stdout.write(`Skipped "${outcome.project}": ${outcome.reason}\n`);

  const isRenameSkipped = !outcome.renamed;
  if (isRenameSkipped) throw new Error(`Project "${outcome.project}" was not renamed.`);
};

export const runProjectDelete = async (name: string, options: ProjectCmdOptions): Promise<void> => {
  assertChatgptWorkspace(options);

  const isNameBlank = !name.trim();
  if (isNameBlank) return failUsage("Usage: bridge project delete <name> --yes");

  const isYesNotGiven = !options.yes;
  if (isYesNotGiven) {
    return failUsage(
      `Refusing to delete project "${name}" without --yes; this permanently deletes its chats.`,
    );
  }

  const { engine, page } = await startWorkspaceSession(options);
  const outcome = await deleteProject(page, name);
  await engine.shutdown({ closeBrowser: false });

  if (options.json) process.stdout.write(`${JSON.stringify(outcome)}\n`);
  else if (outcome.deleted) process.stdout.write(`Deleted project "${outcome.project}"\n`);
  else process.stdout.write(`Skipped "${outcome.project}": ${outcome.reason}\n`);

  const isDeleteSkipped = !outcome.deleted;
  if (isDeleteSkipped) throw new Error(`Project "${outcome.project}" was not deleted.`);
};

export const runChatList = async (options: ChatCmdOptions): Promise<void> => {
  assertChatgptWorkspace(options);
  const { engine } = await startWorkspaceSession(options);
  const chats = await engine
    .getOrchestrator()
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
};

export const runChatSearch = async (query: string, options: ChatCmdOptions): Promise<void> => {
  assertChatgptWorkspace(options);

  const isQueryBlank = !query.trim();
  if (isQueryBlank) failUsage("Usage: bridge chat search <query>");

  const { engine } = await startWorkspaceSession(options);
  let results: ConversationSearchResult[];
  try {
    results = await engine.getOrchestrator().searchConversations({
      query,
      limit: readLimitFromOption(options.limit),
    });
  } catch (error) {
    await engine.shutdown({ closeBrowser: false });
    const isErrorObject = error instanceof Error;
    return fail(isErrorObject ? error.message : String(error));
  }
  await openSearchHitIfFound({ engine, results, open: Boolean(options.open) });
  await engine.shutdown({ closeBrowser: false });
  writeChatSearchOutput(results, options);

  const isThereNoSearchMatch = results.length === 0;
  if (isThereNoSearchMatch) throw new Error(`No conversation matches "${query}".`);
};

const readLimitFromOption = (value: string | undefined): number | undefined => {
  if (!value) return undefined;

  const parsed = Number.parseInt(value, 10);
  const isPositiveNumber = Number.isFinite(parsed) && parsed > 0;
  return isPositiveNumber ? parsed : undefined;
};

const openSearchHitIfFound = async (input: {
  engine: Awaited<ReturnType<typeof startWorkspaceSession>>["engine"];
  results: ConversationSearchResult[];
  open: boolean;
}): Promise<void> => {
  const [best] = input.results;
  const isOpenIncomplete = !input.open || !best;
  if (isOpenIncomplete) return;

  await input.engine.getOrchestrator().navigateToConversation(best.url);
};

const writeChatSearchOutput = (
  results: ConversationSearchResult[],
  options: ChatCmdOptions,
): void => {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(results)}\n`);
    return;
  }

  const hasNoResults = results.length === 0;
  if (hasNoResults) {
    process.stdout.write("No matching conversations.\n");
    return;
  }

  for (const hit of results) {
    process.stdout.write(`${hit.id}	${hit.title}	${hit.source}	${hit.score}
`);
  }
};

export const listChatTargets = (chat: string, options: ChatCmdOptions): string[] => {
  const isIdMissing = options.id === undefined;
  const rawIds = isIdMissing ? [] : options.id;
  const ids = rawIds.map((value) => value.trim()).filter(Boolean);

  const hasIds = ids.length > 0;
  if (hasIds) return ids;

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
  assertChatgptWorkspace(options);
  const project = options.project?.trim();

  const targets = listChatTargets(chat, options);
  const isNothingToSync = targets.length === 0 || !project;
  if (isNothingToSync) {
    return failUsage(
      "Usage: bridge chat move <idOrTitle> --project <name>  (multiple: --id <id...>)",
    );
  }

  const { engine, page } = await startWorkspaceSession(options);
  const outcomes: MoveChatOutcome[] = [];
  try {
    const projectIdByName = await readProjectIds(page, [project]);
    const projectId = readProjectIdNamed(projectIdByName, project);
    for (const target of targets) {
      outcomes.push(await moveChatToProject(page, { chat: target, project, projectId }));
    }
  } finally {
    await engine.shutdown({ closeBrowser: false });
  }
  writeMoveOutcomes(outcomes, options);

  const isAnyChatNotMoved = !outcomes.every((outcome) => outcome.moved || outcome.alreadyFiled);
  if (isAnyChatNotMoved) throw new Error("Some conversations were not moved.");
};

const writeRenamedChat = (renamedChat: RenamedChat, options: ChatCmdOptions): void => {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(renamedChat)}\n`);
    return;
  }

  process.stdout.write(`Renamed ${renamedChat.id} -> "${renamedChat.title}"\n`);
};

export const runChatRename = async (chat: string, options: ChatCmdOptions): Promise<void> => {
  assertChatgptWorkspace(options);
  const [target, ...otherTargets] = listChatTargets(chat, options);
  const title = options.title?.trim() ?? "";

  const isNotUsageValid = target === undefined || otherTargets.length !== 0 || title === "";
  if (isNotUsageValid) {
    return failUsage('Usage: bridge chat rename <idOrTitle> --title "<new title>"  (or --id <id>)');
  }

  const { engine, page } = await startWorkspaceSession(options);
  try {
    const renamedChat = await renameChat(page, { chat: target, title });
    writeRenamedChat(renamedChat, options);
  } finally {
    await engine.shutdown({ closeBrowser: false });
  }
};

const DEFAULT_ORGANIZATION_INTERVAL_SECONDS = 60;
const DEFAULT_ORGANIZATION_MIN_INTERVAL_SECONDS = 15;
const DEFAULT_ORGANIZATION_MAX_INTERVAL_SECONDS = 180;
const DEFAULT_ORGANIZATION_SPEED_UP_AFTER = 3;
const DEFAULT_ORGANIZATION_COOLDOWN_SECONDS = 600;
const DEFAULT_ORGANIZATION_MAX_ATTEMPTS = 4;
const MAX_CONSECUTIVE_ORGANIZATION_COOLDOWNS = 12;
const RATE_LIMIT_REASON = "ChatGPT temporarily limited access to Conversation history.";
const CLOSED_SESSION_REASON = "ChatGPT browser session closed; reopening before retry.";

const readPositiveIntegerOption = (
  value: string | undefined,
  optionName: string,
  defaultValue: number,
): number => {
  const isOptionValueUnset = value === undefined;
  if (isOptionValueUnset) return defaultValue;

  const isNotPositiveInteger = !/^[1-9]\d*$/u.test(value.trim());
  if (isNotPositiveInteger) {
    return failUsage(`${optionName} must be a positive whole number.`);
  }

  const parsed = Number.parseInt(value, 10);
  return parsed;
};

const readOrganizationIntervalOption = (value: string | undefined): ChatOrganizationInterval => {
  try {
    return readChatOrganizationInterval(value, DEFAULT_ORGANIZATION_INTERVAL_SECONDS);
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

const writeChatOrganizationProgress = (message: string, options: ChatOrganizationOptions): void => {
  if (options.json) {
    process.stderr.write(`${message}\n`);
    return;
  }

  process.stdout.write(`${message}\n`);
};

const moveFailureReason = (outcome: MoveChatOutcome): string => {
  if (outcome.reason?.trim()) return outcome.reason;

  return "ChatGPT did not confirm the Conversation move.";
};

const writeChatOrganizationSummary = (input: {
  queuePath: string;
  queue: ChatOrganizationQueue;
  options: ChatOrganizationOptions;
  paused?: boolean;
}): void => {
  const summary = summarizeChatOrganizationQueue(input.queue);

  if (input.options.json) {
    process.stdout.write(
      `${JSON.stringify({
        queuePath: input.queuePath,
        state: input.paused ? "paused" : "finished",
        summary,
        pacing: input.queue.pacing,
        verification: input.queue.verification,
      })}\n`,
    );
    return;
  }

  const isQueuePacingMissing = input.queue.pacing === undefined;
  const isQueueVerificationMissing = input.queue.verification === undefined;
  process.stdout.write(
    `${[
      input.paused ? "Organization queue paused." : "Organization queue finished.",
      `Moved: ${summary.moved}`,
      `Already filed: ${summary.alreadyFiled}`,
      `Pending: ${summary.pending}`,
      `Failed: ${summary.failed}`,
      isQueuePacingMissing
        ? undefined
        : `Adaptive pace: ${input.queue.pacing.currentSeconds}s base (${input.queue.pacing.rateLimitCount} rate limits)`,
      isQueueVerificationMissing
        ? undefined
        : `Full-history verification: ${input.queue.verification.complete ? "complete" : "incomplete"}; ${input.queue.verification.remainingOrphans} intentional/remaining orphans`,
      `Queue state: ${input.queuePath}`,
    ]
      .filter((line) => line !== undefined)
      .join("\n")}\n`,
  );
};

const writeChatOrganizationDryRun = (input: {
  tasks: Awaited<ReturnType<typeof loadChatOrganizationTasks>>;
  queuePath: string;
  interval: ChatOrganizationInterval;
  cooldownSeconds: number;
  maxAttempts: number;
  adaptive: boolean;
  minimumIntervalSeconds: number;
  maximumIntervalSeconds: number;
  speedUpAfter: number;
  options: ChatOrganizationOptions;
}): void => {
  const preview = {
    dryRun: true,
    queuePath: input.queuePath,
    interval: input.interval,
    cooldownSeconds: input.cooldownSeconds,
    maxAttempts: input.maxAttempts,
    adaptive: input.adaptive,
    minimumIntervalSeconds: input.minimumIntervalSeconds,
    maximumIntervalSeconds: input.maximumIntervalSeconds,
    speedUpAfter: input.speedUpAfter,
    tasks: input.tasks,
  };

  if (input.options.json) {
    process.stdout.write(`${JSON.stringify(preview)}\n`);
    return;
  }

  process.stdout.write(
    `${[
      `Organization queue dry run: ${input.tasks.length} Conversations`,
      `Interval: ${readChatOrganizationIntervalLabel(input.interval)}`,
      `Adaptive pacing: ${input.adaptive ? `yes (${input.minimumIntervalSeconds}-${input.maximumIntervalSeconds}s; speed up after ${input.speedUpAfter} successes)` : "no"}`,
      `Rate-limit cooldown: ${input.cooldownSeconds}s`,
      `Attempts per Conversation: ${input.maxAttempts}`,
      `Resume state: ${input.queuePath}`,
      ...input.tasks.map((task) => `  ${task.conversation} -> ${task.project}`),
    ].join("\n")}\n`,
  );
};

const recordChatOrganizationAttempt = async (input: {
  queue: ChatOrganizationQueue;
  queuePath: string;
  index: number;
  maxAttempts: number;
  sessionClosed: boolean;
  rateLimited: boolean;
  moveOutcome?: MoveChatOutcome;
  thrownReason?: string;
}): Promise<ChatOrganizationQueue> => {
  const timestamp = new Date().toISOString();
  let queue: ChatOrganizationQueue;

  if (input.sessionClosed) {
    queue = deferChatOrganizationQueueItem({
      queue: input.queue,
      index: input.index,
      reason: CLOSED_SESSION_REASON,
      timestamp,
    });
  } else if (input.rateLimited) {
    queue = deferChatOrganizationQueueItem({
      queue: input.queue,
      index: input.index,
      reason: RATE_LIMIT_REASON,
      timestamp,
    });
  } else if (input.moveOutcome?.moved) {
    queue = completeChatOrganizationQueueItem({
      queue: input.queue,
      index: input.index,
      status: "moved",
      timestamp,
    });
  } else if (input.moveOutcome?.alreadyFiled) {
    queue = completeChatOrganizationQueueItem({
      queue: input.queue,
      index: input.index,
      status: "already-filed",
      timestamp,
    });
  } else {
    let reason = "ChatGPT did not complete the Conversation move.";

    if (input.moveOutcome !== undefined) reason = moveFailureReason(input.moveOutcome);
    else if (input.thrownReason !== undefined) reason = input.thrownReason;

    queue = failChatOrganizationQueueItem({
      queue: input.queue,
      index: input.index,
      reason,
      maxAttempts: input.maxAttempts,
      timestamp,
    });
  }

  await persistChatOrganizationQueue(input.queuePath, queue);
  return queue;
};

const persistChatOrganizationPacing = async (input: {
  queue: ChatOrganizationQueue;
  queuePath: string;
  pacing: ChatOrganizationPacing;
}): Promise<ChatOrganizationQueue> => {
  const queue = updateChatOrganizationQueuePacing({
    queue: input.queue,
    pacing: input.pacing,
    timestamp: new Date().toISOString(),
  });
  await persistChatOrganizationQueue(input.queuePath, queue);
  return queue;
};

const verifyCompletedChatOrganizationQueue = async (input: {
  queue: ChatOrganizationQueue;
  queuePath: string;
  workspace: Awaited<ReturnType<typeof startWorkspaceSession>>;
  options: ChatOrganizationOptions;
  maxAttempts: number;
}): Promise<ChatOrganizationQueue> => {
  writeChatOrganizationProgress(
    "Verifying the completed plan against an exhaustive full-history orphan scan.",
    input.options,
  );
  const timestamp = new Date().toISOString();
  let verification: NonNullable<ChatOrganizationQueue["verification"]>;
  try {
    const orphans = await input.workspace.engine
      .getOrchestrator()
      .listConversations({ orphans: true });
    verification = verifyChatOrganizationQueue({
      queue: input.queue,
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
    queue: input.queue,
    verification,
    timestamp,
  });

  const hasVerificationPlannedStillLoose = verification.plannedStillLoose.length > 0;
  if (hasVerificationPlannedStillLoose) {
    queue = reopenChatOrganizationQueueItems({
      queue,
      conversations: verification.plannedStillLoose,
      maxAttempts: input.maxAttempts,
      timestamp,
    });
  }

  await persistChatOrganizationQueue(input.queuePath, queue);

  if (verification.inventoryComplete) {
    writeChatOrganizationProgress(
      `Full-history scan reached the stable end: ${verification.remainingOrphans} loose Conversations remain; ${verification.plannedStillLoose.length} planned Conversations are still loose.`,
      input.options,
    );
  } else {
    writeChatOrganizationProgress(
      `Full-history verification could not prove completion: ${verification.error ?? "unknown scan failure"}`,
      input.options,
    );
  }

  return queue;
};

const readOrganizationQueueState = (input: {
  paused: boolean;
  running: boolean;
  summary: ReturnType<typeof summarizeChatOrganizationQueue>;
}): "running" | "pausing" | "paused" | "idle" | "completed" | "failed" => {
  if (input.running) return input.paused ? "pausing" : "running";

  if (input.paused) return "paused";

  const isNothingPending = input.summary.pending === 0;
  const hasFailedItems = input.summary.failed > 0;
  if (isNothingPending) return hasFailedItems ? "failed" : "completed";

  return "idle";
};

export const runChatOrganizeStatus = async (options: ChatOrganizationOptions): Promise<void> => {
  const selected = await findChatOrganizationQueue(repositoryRoot(options.repo), options.queue);
  const summary = summarizeChatOrganizationQueue(selected.queue);
  const queueState = readOrganizationQueueState({
    paused: selected.paused,
    running: selected.running,
    summary,
  });
  const status = {
    state: queueState,
    queuePath: selected.path,
    ownerPid: selected.ownerPid,
    summary,
    pacing: selected.queue.pacing,
    verification: selected.queue.verification,
  };

  if (options.json) process.stdout.write(`${JSON.stringify(status)}\n`);
  else {
    const isQueuePacingMissing = selected.queue.pacing === undefined;
    const isQueueVerificationMissing = selected.queue.verification === undefined;
    process.stdout.write(
      `${[
        `Organization queue: ${queueState}`,
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
      ].join("\n")}\n`,
    );
  }
};

export const runChatOrganizePause = async (options: ChatOrganizationOptions): Promise<void> => {
  const selected = await findChatOrganizationQueue(repositoryRoot(options.repo), options.queue);
  await pauseChatOrganizationQueue(selected.path, new Date().toISOString());
  const message = selected.running
    ? "Pause requested; the active UI operation will finish before the queue releases its lock."
    : "Organization queue paused.";

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ state: selected.running ? "pausing" : "paused", queuePath: selected.path })}\n`,
    );
  } else process.stdout.write(`${message}\nQueue state: ${selected.path}\n`);
};

export const runChatOrganizeResume = async (options: ChatOrganizationOptions): Promise<void> => {
  assertChatgptWorkspace(options);

  const selected = await findChatOrganizationQueue(repositoryRoot(options.repo), options.queue);
  if (selected.running) return fail(`Organization queue is already running: ${selected.path}`);

  await clearChatOrganizationQueuePause(selected.path);
  const plan = JSON.stringify(
    selected.queue.items.map((item) => ({
      conversation: item.conversation,
      project: item.project,
    })),
  );
  return runChatOrganize({ ...options, plan, restart: false, dryRun: false });
};

const listPlannedProjectNames = (tasks: readonly { readonly project: string }[]): string[] => {
  return tasks.map((task) => task.project);
};

// Every planned Project must exist before the first move. Throws with the missing names.
const checkPlannedProjectsExist = async (
  options: ChatOrganizationOptions,
  projectNames: string[],
): Promise<void> => {
  const { engine, page } = await startWorkspaceSession(options);
  try {
    await readProjectIds(page, projectNames);
  } finally {
    await engine.shutdown({ closeBrowser: false });
  }
};

export const runChatOrganize = async (options: ChatOrganizationOptions): Promise<void> => {
  assertChatgptWorkspace(options);

  const plan = options.plan;
  const isPlanMissing = plan === undefined || !plan.trim();
  if (isPlanMissing) {
    return failUsage("Usage: bridge chat organize --plan <fileOrJson>");
  }

  const interval = readOrganizationIntervalOption(options.interval);
  const adaptive = options.adaptive !== false;
  const minimumIntervalSeconds = readPositiveIntegerOption(
    options.minInterval,
    "--min-interval",
    DEFAULT_ORGANIZATION_MIN_INTERVAL_SECONDS,
  );

  const maximumIntervalSeconds = readPositiveIntegerOption(
    options.maxInterval,
    "--max-interval",
    DEFAULT_ORGANIZATION_MAX_INTERVAL_SECONDS,
  );
  const isIntervalInverted = maximumIntervalSeconds < minimumIntervalSeconds;
  if (isIntervalInverted) {
    return failUsage("--max-interval must be greater than or equal to --min-interval.");
  }

  const speedUpAfter = readPositiveIntegerOption(
    options.speedUpAfter,
    "--speed-up-after",
    DEFAULT_ORGANIZATION_SPEED_UP_AFTER,
  );
  const cooldownSeconds = readPositiveIntegerOption(
    options.cooldown,
    "--cooldown",
    DEFAULT_ORGANIZATION_COOLDOWN_SECONDS,
  );
  const maxAttempts = readPositiveIntegerOption(
    options.maxAttempts,
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
  const repoRoot = repositoryRoot(options.repo);
  const queuePath = readChatOrganizationQueuePath(repoRoot, tasks);

  if (options.dryRun) {
    await checkPlannedProjectsExist(options, listPlannedProjectNames(tasks));
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
      options,
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
      restart: Boolean(options.restart),
      timestamp: new Date().toISOString(),
    });
    queue = opened.queue;

    if (adaptive) {
      const pacing =
        queue.pacing === undefined
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
    options,
  );

  const needsVerification = options.verify !== false && queue.verification?.complete !== true;
  const isQueueDrainedWithoutVerification = initialSummary.pending === 0 && !needsVerification;
  if (isQueueDrainedWithoutVerification) {
    writeChatOrganizationSummary({ queuePath, queue, options });
    await releaseQueueLock();

    const isOrganizationUnfinished =
      initialSummary.failed > 0 ||
      (options.verify !== false && queue.verification?.complete !== true);
    if (isOrganizationUnfinished) {
      throw new Error("Chat organization has failed or unverified conversations.");
    }

    return;
  }

  let workspace: Awaited<ReturnType<typeof startWorkspaceSession>>;
  try {
    workspace = await startWorkspaceSession(options);
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
      while (index !== undefined) {
        const isQueuePaused = await isChatOrganizationQueuePaused(queuePath);
        if (isQueuePaused) {
          paused = true;
          writeChatOrganizationProgress(
            "Organization queue pause acknowledged; no new UI operation will start.",
            options,
          );
          break;
        }

        const item = queue.items[index];
        const isTaskNotPending = item === undefined || item.status !== "pending";
        if (isTaskNotPending) {
          index = findNextChatOrganizationQueueIndex(queue);
          continue;
        }

        const hasAcknowledgedRateLimit = await dismissChatGptHistoryRateLimit(workspace.page);
        if (hasAcknowledgedRateLimit) {
          consecutiveRateLimitCooldowns += 1;

          const isAdaptivePacingOn = adaptive && queue.pacing !== undefined;
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
              options,
            );
            halted = true;
            break;
          }

          const isQueuePacingMissing = queue.pacing === undefined;
          writeChatOrganizationProgress(
            `ChatGPT rate limit detected; cooling down for ${cooldownSeconds}s before continuing${isQueuePacingMissing ? "." : ` at a slower ${queue.pacing.currentSeconds}s adaptive pace.`}`,
            options,
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
          `Moving "${item.conversation}" -> ${item.project} (attempt ${item.attempts + 1}/${maxAttempts})`,
          options,
        );
        let moveOutcome: MoveChatOutcome | undefined;
        let thrownReason: string | undefined;
        try {
          moveOutcome = await moveChatToProject(workspace.page, {
            chat: item.conversation,
            project: item.project,
            projectId: readProjectIdNamed(projectIdByName, item.project),
          });
        } catch (error) {
          thrownReason = error instanceof Error ? error.message : String(error);
        }
        const sessionClosed = isChatOrganizationSessionClosed(thrownReason);
        const isRateLimitedOnPage = await dismissChatGptHistoryRateLimit(workspace.page);
        const isRateLimitedByMove = moveOutcome?.rateLimited === true;
        const rateLimited = isRateLimitedOnPage || isRateLimitedByMove;
        queue = await recordChatOrganizationAttempt({
          queue,
          queuePath,
          index,
          maxAttempts,
          sessionClosed,
          rateLimited,
          moveOutcome,
          thrownReason,
        });

        const hasAdaptivePacing = adaptive && queue.pacing !== undefined;
        if (hasAdaptivePacing) {
          let pacing = queue.pacing;

          if (rateLimited) {
            pacing = slowDownPacingAfterRateLimit(pacing, {
              maximumSeconds: maximumIntervalSeconds,
            });
          } else if (moveOutcome?.moved || moveOutcome?.alreadyFiled) {
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
            options,
          );
          await workspace.engine.shutdown({ closeBrowser: false });
          workspaceWasShutdown = true;
          try {
            workspace = await startWorkspaceSession(options);
            workspaceWasShutdown = false;
          } catch (error) {
            writeChatOrganizationProgress(
              `Could not reopen the ChatGPT browser session; leaving the queue pending: ${
                error instanceof Error ? error.message : String(error)
              }`,
              options,
            );
            halted = true;
            break;
          }
          index = findNextChatOrganizationQueueIndex(queue);
          continue;
        }

        const recorded = queue.items[index];

        const isRecordedStatusMoved = recorded?.status === "moved";
        if (isRecordedStatusMoved) {
          writeChatOrganizationProgress(`Moved "${recorded.conversation}".`, options);
        } else if (recorded?.status === "already-filed") {
          writeChatOrganizationProgress(`Already filed "${recorded.conversation}".`, options);
        } else if (recorded?.status === "failed") {
          writeChatOrganizationProgress(
            `Failed "${recorded.conversation}" after ${recorded.attempts} attempts: ${recorded.reason}`,
            options,
          );
        } else if (recorded?.status === "pending") {
          let reason = "unknown failure";

          const hasRecordedLastReason = recorded.lastReason !== undefined;
          if (hasRecordedLastReason) reason = recorded.lastReason;

          writeChatOrganizationProgress(
            `Will retry "${recorded.conversation}": ${reason}`,
            options,
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

        const hasIndex = index !== undefined;
        if (hasIndex) {
          writeChatOrganizationProgress(
            `Waiting ${waitSeconds}s before the next UI operation${adaptive ? " (adaptive)." : "."}`,
            options,
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
        options.verify !== false && summarizeChatOrganizationQueue(queue).pending === 0;
      if (isQueueVerified) {
        queue = await verifyCompletedChatOrganizationQueue({
          queue,
          queuePath,
          workspace,
          options,
          maxAttempts,
        });
      }

      const reopened = findNextChatOrganizationQueueIndex(queue);

      const isReopenedMissing = reopened === undefined;
      if (isReopenedMissing) break;

      writeChatOrganizationProgress(
        "The full-history audit found planned Conversations still loose; retrying them automatically.",
        options,
      );
      consecutiveRateLimitCooldowns = 0;
    }
  } finally {
    try {
      const isWorkspaceNotShutdown = !workspaceWasShutdown;
      if (isWorkspaceNotShutdown) await workspace.engine.shutdown({ closeBrowser: false });
    } finally {
      await releaseQueueLock();
    }
  }
  const summary = summarizeChatOrganizationQueue(queue);
  writeChatOrganizationSummary({ queuePath, queue, options, paused });

  if (paused) return;

  const isOrganizationIncomplete =
    summary.failed > 0 ||
    summary.pending > 0 ||
    (options.verify !== false && queue.verification?.complete !== true);
  if (isOrganizationIncomplete) {
    throw new Error("Chat organization has pending, failed or unverified conversations.");
  }
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
  assertChatgptWorkspace(options);
  const targets = listChatTargets(chat, options);

  const isTargetsEmpty = targets.length === 0;
  if (isTargetsEmpty) {
    return failUsage("Usage: bridge chat archive <idOrTitle>  (multiple: --id <id...>)");
  }

  const { engine, page } = await startWorkspaceSession(options);
  const outcomes: ArchiveChatOutcome[] = [];
  for (const target of targets) {
    outcomes.push(await archiveChat(page, target));
  }
  await engine.shutdown({ closeBrowser: false });
  writeArchiveOutcomes(outcomes, options);

  const isAnyChatNotArchived = !outcomes.every((outcome) => outcome.archived);
  if (isAnyChatNotArchived) throw new Error("Some conversations were not archived.");
};

export const runTaskList = async (options: TaskCmdOptions): Promise<void> => {
  assertChatgptWorkspace(options);
  const { engine, page } = await startWorkspaceSession(options);
  const tasks = await listTasks(page);
  await engine.shutdown({ closeBrowser: false });

  if (options.json) process.stdout.write(`${JSON.stringify(tasks)}\n`);
  else if (tasks.length === 0) process.stdout.write("No scheduled tasks.\n");
  else
    for (const task of tasks)
      process.stdout.write(`${task.title}${task.schedule ? `\t${task.schedule}` : ""}\n`);
};

export const runTaskCreate = async (prompt: string, options: TaskCmdOptions): Promise<void> => {
  assertChatgptWorkspace(options);

  const isPromptBlank = !prompt.trim();
  if (isPromptBlank) failUsage("Usage: bridge task create <prompt> [--every <spec> | --at <spec>]");

  const { engine } = await startWorkspaceSession(options);
  const scheduledPrompt = readScheduledTaskPrompt(prompt, options);
  const reply = await engine.ask({ content: scheduledPrompt });
  await engine.shutdown({ closeBrowser: false });

  if (options.json) {
    const isReplyMissing = reply === undefined || reply === null;
    const replyContent = isReplyMissing ? null : reply.content;
    process.stdout.write(`${JSON.stringify({ content: scheduledPrompt, reply: replyContent })}\n`);
  } else if (reply === undefined || reply === null) {
    process.stdout.write("(no reply captured)\n");
  } else {
    process.stdout.write(`${reply.content}\n`);
  }
};

export const readScheduledTaskPrompt = (prompt: string, options: TaskCmdOptions): string => {
  const cadence = readScheduledTaskCadence(options);

  const isCadenceMissing = cadence === undefined;
  if (isCadenceMissing) return `Set up a ChatGPT scheduled task: ${prompt.trim()}.`;

  return `Set up a ChatGPT scheduled task: ${prompt.trim()}. Schedule it to run ${cadence}.`;
};

const readScheduledTaskCadence = (options: TaskCmdOptions): string | undefined => {
  if (options.every) return `every ${options.every}`;

  if (options.at) return `at ${options.at}`;

  return undefined;
};

export const runChromeStart = async (options: ChromeStartOptions = {}): Promise<void> => {
  const browser = await launchChromeBrowser(options);
  await browser.closeOwnTab();
  writeChromeStartInstructions(readProvider(readProviderIdFrom(options.provider)).displayName);
};

const launchChromeBrowser = async (options: ChromeStartOptions): Promise<BrowserSession> => {
  const provider = readProviderIdFrom(options.provider);
  const browser = new BrowserSession(provider, {
    debugPort: parsePortFlag("--debug-port", options.debugPort),
    profileRoot: readProfileRootFromOption(options.profile),
  });
  await browser.launch();
  return browser;
};

const writeChromeStartInstructions = (displayName: string): void => {
  const isMyChromeChosen = configuredBrowserChoice() === "my-chrome";
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

const runTui = async (opts: CliOptions & { browser?: boolean }): Promise<void> => {
  const isThereNoTerminal = !process.stdout.isTTY;
  if (isThereNoTerminal) {
    failUsage(
      "bridge: the interactive TUI needs a TTY. Use `bridge ask <prompt>` for non-interactive or piped use.",
    );
  }

  const provider = readProviderIdFrom(opts.provider);
  const label = readProviderDisplayName(provider);
  console.log(`\nStarting ai-browser-bridge (${label})...`);
  const engine = await startEngine({
    repoPath: opts.repo ? resolve(opts.repo) : undefined,
    provider,
    mcpPort: parsePortFlag("--port", opts.port),
    withBrowser: opts.browser !== false,
    withTools: provider === "chatgpt",
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

const attachOrchestratorListener = (input: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  messages: Message[];
}): void => {
  input.engine.getOrchestrator().on((event) => {
    const isEventTypeMessage = event.type === "message";
    if (isEventTypeMessage) input.messages.push(event.message);

    const isEventTypeConversationSynced = event.type === "conversation_synced";
    if (isEventTypeConversationSynced) {
      input.messages.length = 0;
      input.messages.push(...event.messages);
    }

    const isEventTypeReset = event.type === "reset";
    if (isEventTypeReset) input.messages.length = 0;

    const isEventTypeError = event.type === "error";
    if (isEventTypeError) {
      input.messages.push({
        id: crypto.randomUUID(),
        role: "assistant",
        content: `⚠ ${event.error}`,
        timestamp: Date.now(),
      });
    }
  });
};

// The TUI's /exit: stop the engine, then unmount so renderTui returns and the CLI ends with 0.
const shutDownTui = async (
  engine: Awaited<ReturnType<typeof startEngine>>,
  app: ReturnType<typeof render>,
): Promise<void> => {
  await stopEngine(engine);
  app.unmount();
};

const startBridgeApp = (input: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  messages: Message[];
  shutdown: () => Promise<void>;
}): ReturnType<typeof render> => {
  return render(
    React.createElement(BridgeApp, {
      config: input.engine.config,
      sendMessage: async (content: string) => {
        await input.engine.ask({ content });
      },
      clearMessages: () => {
        input.messages.length = 0;
      },
      shutdown: input.shutdown,
      messages: input.messages,
      counter: input.engine.counter,
      orchestrator: input.engine.getOrchestrator(),
      permission: {
        getMode: () => input.engine.permissionMode,
        setMode: (mode) => {
          input.engine.permissionMode = mode;
        },
      },
      session: {
        getId: () => input.engine.sessionId,
        setId: (id) => {
          input.engine.sessionId = id;
        },
      },
      statusline: {
        branch: input.engine.branch,
        toolCallCount: () => input.engine.toolActions.length,
      },
    }),
  );
};

export const runInteractiveCli = async (
  options: CliOptions & { browser?: boolean },
): Promise<void> => {
  await runTui(options);
};

export const runAsk = async (prompt: string, options: AskOptions): Promise<void> => {
  await runAskFlow({ prompt, options });
};

const createRenderStateLine = (state: ChatGptRenderState): string => {
  const parts = [
    state.streaming ? "streaming" : "idle",
    `images ${state.images.loaded}/${state.images.total}`,
  ];

  const hasPendingImages = state.images.pending > 0;
  if (hasPendingImages) parts.push(`${state.images.pending} pending`);

  const hasExpectedImages = state.expectedImageMarkers > 0;
  if (hasExpectedImages) parts.push(`${state.expectedImageMarkers} expected`);

  if (state.misfireSuspected) parts.push("misfire?");

  if (state.limitHit) {
    const limitNotice = state.limitNotice === undefined ? "hit" : state.limitNotice;
    parts.push(`limit: ${limitNotice}`);
  }

  return parts.join(" | ");
};

export const runChatgptInspect = async (options: ChatgptCmdOptions): Promise<void> => {
  const { engine, page } = await startWorkspaceSession(options);

  if (options.allTabs) {
    const tabs = await readAllChatGptTabRenderStates(page);
    await engine.shutdown({ closeBrowser: false });

    if (options.json) process.stdout.write(`${JSON.stringify(tabs)}\n`);
    else if (tabs.length === 0) process.stdout.write("No ChatGPT tabs open.\n");
    else
      for (const tab of tabs) process.stdout.write(`${createRenderStateLine(tab)}\t${tab.url}\n`);

    return;
  }

  const state = await readChatGptRenderState(page);
  await engine.shutdown({ closeBrowser: false });
  process.stdout.write(
    options.json ? `${JSON.stringify(state)}\n` : `${createRenderStateLine(state)}\n`,
  );
};

const startFlowSession = async (options: FlowCmdOptions) => {
  const engine = await startEngine({
    repoPath: options.repo ? resolve(options.repo) : undefined,
    provider: "flow",
    mcpPort: parsePortFlag("--port", options.port),
    withBrowser: true,
    withTools: false,
    debugPort: parsePortFlag("--debug-port", options.debugPort),
    profileRoot: readProfileRootFromOption(options.profile),
  });
  return { engine, page: requireBrowserPage(engine) };
};

const DESIGN_ATTACH_WAIT_MS = 30_000;

// Throws instead of exiting so `bridge serve` reports a missing browser per tool call.
const startDesignSession = async (options: CliOptions & BrowserTargetOptions) => {
  const engine = await startEngine({
    repoPath: options.repo ? resolve(options.repo) : undefined,
    provider: "design",
    mcpPort: parsePortFlag("--port", options.port),
    withBrowser: true,
    withTools: false,
    persist: false,
    debugPort: parsePortFlag("--debug-port", options.debugPort),
    profileRoot: readProfileRootFromOption(options.profile),
  });

  const browser = engine.browser;
  const isBrowserMissing = browser == null;
  if (isBrowserMissing) {
    await Promise.allSettled([engine.shutdown({ closeBrowser: false })]);
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
    await Promise.allSettled([engine.shutdown({ closeBrowser: false })]);
    throw error;
  }
  return { engine, page };
};

// Each Design call attaches to the warm bridge Chrome, drives one page operation, then
// detaches while leaving Chrome and its tabs open.
export const runWithDesignPage = async <T>(
  options: CliOptions & BrowserTargetOptions,
  runPage: (page: Page, repoRoot: string) => Promise<T>,
): Promise<T> => {
  const { engine, page } = await startDesignSession(options);
  try {
    return await runPage(page, engine.config.repoPath);
  } finally {
    await Promise.allSettled([engine.shutdown({ closeBrowser: false })]);
  }
};

const readDefaultFlowOutputDirectory = (repoRoot: string): string =>
  join(downloadsDir(repoRoot), "flow");

const requireClipId = (options: FlowCmdOptions, verb: string): string => {
  const id = options.id?.[0];
  const isIdBlank = id === undefined || id === "";
  if (isIdBlank) return failUsage(`Usage: bridge flow ${verb} --id <clipId>`);

  return id;
};

export const runFlowClips = async (options: FlowCmdOptions): Promise<void> => {
  const { engine, page } = await startFlowSession(options);
  const clips = await listClips(page);
  await engine.shutdown({ closeBrowser: false });

  if (options.json) process.stdout.write(`${JSON.stringify(clips)}\n`);
  else if (clips.length === 0) process.stdout.write("No clips in the current Flow project.\n");
  else for (const clip of clips) process.stdout.write(`${clip.id}\t${clip.url}\n`);
};

export const runFlowProjects = async (options: FlowCmdOptions): Promise<void> => {
  const { engine, page } = await startFlowSession(options);
  const projects = await listFlowProjects(page);
  await engine.shutdown({ closeBrowser: false });

  if (options.json) process.stdout.write(`${JSON.stringify(projects)}\n`);
  else if (projects.length === 0) process.stdout.write("No Flow projects.\n");
  else for (const project of projects) process.stdout.write(`${project.id}\t${project.title}\n`);
};

export const runFlowDownload = async (options: FlowCmdOptions): Promise<void> => {
  const { engine, page } = await startFlowSession(options);
  const clips = await listClips(page);
  const hasId = options.id && options.id.length > 0;
  const targets = hasId ? options.id : clips.map((clip) => clip.id);
  const outDir = options.out
    ? resolve(options.out)
    : readDefaultFlowOutputDirectory(engine.config.repoPath);
  const results: Array<{ id: string; ok: boolean; file?: string; error?: string }> = [];
  for (const id of targets) {
    try {
      results.push({ id, ok: true, file: await downloadClip(page, id, outDir) });
    } catch (err) {
      const isErrorObject = err instanceof Error;
      results.push({ id, ok: false, error: isErrorObject ? err.message : String(err) });
    }
  }
  await engine.shutdown({ closeBrowser: false });

  if (options.json) process.stdout.write(`${JSON.stringify(results)}\n`);
  else if (results.length === 0) process.stdout.write("No clips to download.\n");
  else
    for (const download of results) {
      if (download.ok)
        process.stdout.write(`${download.id}	${download.file}
`);
      else
        process.stdout.write(`${download.id}	ERROR ${download.error}
`);
    }

  const isAnyDownloadFailed = !results.every((download) => download.ok);
  if (isAnyDownloadFailed) throw new Error("Some downloads failed.");
};

export const runFlowGenerate = async (options: FlowCmdOptions): Promise<void> => {
  const startFramePath = options.start ? resolve(options.start) : "";

  const prompt = options.prompt === undefined ? "" : options.prompt.trim();
  const isVideoSetupIncomplete = !startFramePath || !prompt;
  if (isVideoSetupIncomplete) {
    failUsage("Usage: bridge flow generate --start <imagePath> --prompt <text> [--out <dir>]");
  }

  const { engine, page } = await startFlowSession(options);
  const outDir = options.out
    ? resolve(options.out)
    : readDefaultFlowOutputDirectory(engine.config.repoPath);
  try {
    const clip = await generateClipFromFrame(page, {
      startFramePath,
      prompt,
      onProgress: (message) => process.stderr.write(`flow generate: ${message}\n`),
    });
    const file = await downloadClip(page, clip.id, outDir);
    await engine.shutdown({ closeBrowser: false });

    if (options.json)
      process.stdout.write(`${JSON.stringify({ id: clip.id, url: clip.url, file })}\n`);
    else process.stdout.write(`${clip.id}\t${file}\n`);

    return;
  } catch (err) {
    await Promise.allSettled([engine.shutdown({ closeBrowser: false })]);
    const isErrorObject = err instanceof Error;
    return fail(isErrorObject ? err.message : String(err));
  }
};

export const runFlowDelete = async (options: FlowCmdOptions): Promise<void> => {
  const id = requireClipId(options, "delete");

  const isYesNotGiven = !options.yes;
  if (isYesNotGiven) {
    failUsage(
      "Refusing to delete without --yes. `bridge flow delete --id <clipId> --yes` moves the clip to Flow Trash (recoverable).",
    );
  }

  const { engine, page } = await startFlowSession(options);
  await deleteClip(page, id);
  await engine.shutdown({ closeBrowser: false });
  process.stdout.write(
    options.json
      ? `${JSON.stringify({ id, movedToTrash: true })}\n`
      : `Moved clip ${id} to Trash.\n`,
  );
};

export const runFlowRename = async (options: FlowCmdOptions): Promise<void> => {
  const id = requireClipId(options, "rename");

  const name = options.name?.trim();
  const isNameEmpty = !name;
  if (isNameEmpty) return failUsage("Usage: bridge flow rename --id <clipId> --name <text>");

  const { engine, page } = await startFlowSession(options);
  await renameClip(page, id, name);
  await engine.shutdown({ closeBrowser: false });
  process.stdout.write(
    options.json ? `${JSON.stringify({ id, name })}\n` : `Renamed clip ${id} to "${name}".\n`,
  );
};

export const runFlowExtend = async (options: FlowCmdOptions): Promise<void> => {
  const id = requireClipId(options, "extend");
  const { engine, page } = await startFlowSession(options);
  await addClipToScene(page, id);
  await engine.shutdown({ closeBrowser: false });
  process.stdout.write(
    options.json ? `${JSON.stringify({ id, addedTo: "scene" })}\n` : `Added clip ${id} to scene.\n`,
  );
};

export const runFlowReuse = async (options: FlowCmdOptions): Promise<void> => {
  const id = requireClipId(options, "reuse");
  const { engine, page } = await startFlowSession(options);
  await addClipToPrompt(page, id);
  await engine.shutdown({ closeBrowser: false });
  process.stdout.write(
    options.json
      ? `${JSON.stringify({ id, addedTo: "prompt" })}\n`
      : `Added clip ${id} to prompt.\n`,
  );
};

export const runFlowProjectRename = async (options: FlowCmdOptions): Promise<void> => {
  const name = options.name?.trim();
  const isNameEmpty = !name;
  if (isNameEmpty) return failUsage("Usage: bridge flow project-rename --name <text>");

  const { engine, page } = await startFlowSession(options);
  await renameFlowProject(page, name);
  await engine.shutdown({ closeBrowser: false });
  process.stdout.write(
    options.json ? `${JSON.stringify({ project: name })}\n` : `Renamed project to "${name}".\n`,
  );
};

export const runFlowProjectDelete = async (options: FlowCmdOptions): Promise<void> => {
  const isYesNotGiven = !options.yes;
  if (isYesNotGiven) {
    failUsage(
      "Refusing to delete a project without --yes. `bridge flow project-delete --yes` permanently deletes the current project.",
    );
  }

  const { engine, page } = await startFlowSession(options);
  await deleteFlowProject(page);
  await engine.shutdown({ closeBrowser: false });
  process.stdout.write(
    options.json ? `${JSON.stringify({ deleted: true })}\n` : "Deleted the current Flow project.\n",
  );
};

export const runFlowIngredients = async (options: FlowCmdOptions): Promise<void> => {
  const { engine, page } = await startFlowSession(options);
  const ingredients = await listIngredients(page);
  await engine.shutdown({ closeBrowser: false });

  if (options.json) process.stdout.write(`${JSON.stringify(ingredients)}\n`);
  else if (ingredients.length === 0)
    process.stdout.write("No ingredients attached to the prompt.\n");
  else for (const item of ingredients) process.stdout.write(`${item.id}\t${item.url}\n`);
};

export const runFlowIngredientRemove = async (options: FlowCmdOptions): Promise<void> => {
  const id = options.id?.[0];
  const isIdBlank = id === undefined || id === "";
  if (isIdBlank) return failUsage("Usage: bridge flow ingredient-remove --id <mediaId>");

  const { engine, page } = await startFlowSession(options);
  await removeIngredient(page, id);
  await engine.shutdown({ closeBrowser: false });
  process.stdout.write(
    options.json ? `${JSON.stringify({ id, removed: true })}\n` : `Removed ingredient ${id}.\n`,
  );
};

export const runFlowIngredientClear = async (options: FlowCmdOptions): Promise<void> => {
  const { engine, page } = await startFlowSession(options);
  const removed = await clearIngredients(page);
  await engine.shutdown({ closeBrowser: false });
  process.stdout.write(
    options.json ? `${JSON.stringify({ removed })}\n` : `Removed ${removed} ingredient(s).\n`,
  );
};
