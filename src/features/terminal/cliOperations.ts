import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { Schema } from "effect";
import { render } from "ink";
import type { Page } from "playwright";
import React from "react";
import { type BridgeProviderId, DEFAULT_PROVIDER } from "@/config";
import { type AskGatewayDeps, serveAskGatewayStdio } from "@/features/agentGateway";
import type { BridgeEngine } from "@/features/bridge";
import {
  type FanoutOptions,
  type FanoutResult,
  type FanoutTask,
  FanoutTasksSchema,
  fanOutConversations,
  fanoutFailed,
  startEngine,
} from "@/features/bridge";
import type { BrowserStatus, CacheInventory, PruneCacheResult } from "@/features/browser";
import {
  BRIDGE_DEBUG_PORT,
  BrowserSession,
  bridgeChromeProfileRoot,
  inventoryChromeCache,
  pruneChromeCache,
  readBrowserStatus,
} from "@/features/browser";
import type { ConversationSearchResult } from "@/features/conversationCatalog";
import type {
  Attachment,
  CommandContext,
  CommandDef,
  ConnectorSetupResult,
  Message,
} from "@/features/domain";
import {
  findModelProfile,
  listModelProfiles,
  normalizePermissionMode,
  PERMISSION_MODES,
} from "@/features/domain";
import type { ArchiveChatOutcome, MoveChatOutcome } from "@/features/providers";
import {
  addClipToPrompt,
  addClipToScene,
  archiveChat,
  type ChatGptRenderState,
  chatGptConversationIdFromUrl,
  chatGptConversationUrlFromIdOrUrl,
  clearIngredients,
  createProject,
  deleteClip,
  deleteFlowProject,
  deleteProject,
  downloadAll,
  downloadAttachment,
  downloadClip,
  extractAllMessages,
  generateClipFromFrame,
  isSameChatGptConversation,
  listClips,
  listFlowProjects,
  listIngredients,
  listProjects,
  listTasks,
  loadManifest,
  moveChatToProject,
  providerFor,
  providerIdFrom,
  providerIdsFrom,
  readAllChatGptTabRenderStates,
  readChatGptRenderState,
  removeIngredient,
  renameClip,
  renameFlowProject,
  renameProject,
} from "@/features/providers";
import type { SessionMetadata } from "@/features/store";
import {
  attachmentManifestsDir,
  bridgeLogPath,
  downloadsDir,
  exportSession,
  exportsDir,
  getLatestSession,
  listCheckpoints,
  listSessions,
  loadSession,
  repositoryPath,
  repositoryRoot,
  restoreCheckpoint,
  type SessionExport,
  type SessionStoreOptions,
  screenshotsDir,
  sessionsDir,
} from "@/features/store";
import { toolRegistry, trimOutput } from "@/features/tools";
import {
  loadCustomCommands,
  loadProjectInstructions,
  renderCustomCommandPrompt,
} from "@/features/userConfig";
import type {
  AskOptions,
  BrowserStatusOptions,
  BrowserTargetOptions,
  CacheCmdOptions,
  ChatCmdOptions,
  ChatgptCmdOptions,
  ChromeStartOptions,
  CliOptions,
  DownloadCmdOptions,
  DownloadResult,
  FlowCmdOptions,
  ProjectCmdOptions,
  ServeOptions,
  TaskCmdOptions,
} from "./cliTypes.ts";
import { providerDisplayName } from "./providerLabel.ts";
import { BridgeApp } from "./tui/shell/App.tsx";

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

export const projectTaskPrompt = (task: string, ctx: CommandContext): string => {
  return projectTaskPromptWithInstructions(task, ctx, "");
};

// Front-loads a "prove the connector is active" step: if ChatGPT answers from
// `/mnt/data` or asks for a zip/tree, the connector is not wired up.
export const projectTaskPromptWithInstructions = (
  task: string,
  ctx: CommandContext,
  projectInstructions: string,
): string => {
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
    ...(projectInstructions.trim()
      ? ["", "Project instruction files:", projectInstructions.trim()]
      : []),
    "",
    "User task:",
    task.trim(),
  ].join("\n");
};

// null when no tunnel; otherwise `<url>/mcp` unless already `/mcp` or `/sse`.
export const mcpConnectorUrl = (tunnelUrl?: string): string | null => {
  if (tunnelUrl === undefined || tunnelUrl === "") return null;
  const normalized = tunnelUrl.replace(/\/+$/, "");
  return normalized.endsWith("/mcp") || normalized.endsWith("/sse")
    ? normalized
    : `${normalized}/mcp`;
};

export const formatSessionSummary = (session: SessionMetadata, currentId?: string): string => {
  const marker = session.id === currentId ? "current" : "loaded";
  return [
    `Local session ${marker}: ${session.id}`,
    `Repo: ${session.repoPath}`,
    `Model: ${sessionModelLabel(session.model)}`,
    `Context: ${session.contextLimit.toLocaleString()} tokens`,
    `Updated: ${session.updatedAt}`,
    `Tunnel: ${sessionTunnelLabel(session.tunnelUrl)}`,
  ].join("\n");
};

const sessionModelLabel = (model: string | null | undefined): string => {
  if (model === undefined || model === null || model === "") return "unknown";
  return model;
};

const sessionTunnelLabel = (tunnelUrl: string | null | undefined): string => {
  if (tunnelUrl === undefined || tunnelUrl === null || tunnelUrl === "") return "none";
  return tunnelUrl;
};

export const formatBridgeStatus = (ctx: CommandContext): string => {
  const provider = providerIdFrom(ctx.config.provider);
  return [
    `Provider: ${provider}`,
    `Repo: ${ctx.config.repoPath}`,
    `Branch: ${statusBranchLabel(ctx)}`,
    `Session: ${statusSessionLabel(ctx)}`,
    `Model: ${ctx.counter.modelLabel}`,
    `Context: ${ctx.counter.summary}`,
    `Permission: ${statusPermissionLabel(ctx)}`,
    `Tool calls: ${statusToolCallCount(ctx)}`,
    `Tunnel: ${statusTunnelLabel(ctx)}`,
    `Connector: ${statusConnectorLabel(ctx)}`,
  ].join("\n");
};

const statusBranchLabel = (ctx: CommandContext): string => {
  const branch = ctx.statusline?.branch;
  if (branch === undefined || branch === "") return "unknown";
  return branch;
};

const statusSessionLabel = (ctx: CommandContext): string => {
  const sessionId = ctx.session?.getId();
  if (sessionId === undefined || sessionId === "") return "none";
  return sessionId;
};

const statusPermissionLabel = (ctx: CommandContext): string => {
  const liveMode = ctx.permission?.getMode();
  if (liveMode !== undefined) return liveMode;
  if (ctx.config.permissionMode !== undefined) return ctx.config.permissionMode;
  return "auto";
};

const statusToolCallCount = (ctx: CommandContext): number => {
  const liveCount = ctx.statusline?.toolCallCount();
  if (liveCount !== undefined) return liveCount;
  return 0;
};

const statusTunnelLabel = (ctx: CommandContext): string => {
  if (ctx.config.tunnelUrl === undefined || ctx.config.tunnelUrl === "") return "none";
  return ctx.config.tunnelUrl;
};

const statusConnectorLabel = (ctx: CommandContext): string => {
  const connector = mcpConnectorUrl(ctx.config.tunnelUrl);
  if (connector === null) return "none";
  return connector;
};

const formatBrowserDebugStatus = (status: BrowserStatus): string => {
  return [
    `State: ${status.state}`,
    `Chrome running: ${status.chromeRunning ? "yes" : "no"}`,
    `Debug port: ${status.debugPortListening ? "ready" : "closed"} (${status.port})`,
    `Can attach: ${status.canAttach ? "yes" : "no"}`,
    `Profile root: ${browserProfileRootLabel(status)}`,
    `Message: ${status.message}`,
  ].join("\n");
};

const browserProfileRootLabel = (status: BrowserStatus): string => {
  if (status.userDataDir !== undefined && status.userDataDir !== null) return status.userDataDir;
  return status.bridgeProfileRoot;
};

const formatCacheInventory = (inventory: CacheInventory): string => {
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

const formatCachePruneResult = (result: PruneCacheResult): string => {
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

export const formatMcpDiagnostics = (ctx: CommandContext): string => {
  const toolCallCount = statusToolCallCount(ctx);
  return [
    "MCP bridge diagnostics:",
    `Local server: http://localhost:${ctx.config.mcpPort}`,
    `Tunnel: ${statusTunnelLabel(ctx)}`,
    `Connector: ${statusConnectorLabel(ctx)}`,
    `Tools: ${[...toolRegistry.keys()].join(", ")}`,
    `Tool calls observed this session: ${toolCallCount}`,
    `Status: ${mcpToolCallStatusLabel(toolCallCount)}`,
    "",
    "If ChatGPT says it cannot access local files:",
    "1. Startup automatically syncs the current Connector URL into ChatGPT when browser automation is connected.",
    "2. Run /connector only to retry that browser setup flow after a UI drift or account permission issue.",
    "3. Ask explicitly: use the ai-browser-bridge connector; do not answer from memory.",
    "4. A reply mentioning /mnt/data, upload a zip, or paste tree/find output means ChatGPT is not using this local connector.",
  ].join("\n");
};

const mcpToolCallStatusLabel = (toolCallCount: number): string => {
  if (toolCallCount > 0) return "MCP tool calls observed in this bridge session.";
  return "No MCP tool calls observed yet; the current ChatGPT chat may not have the connector enabled.";
};

export const formatConnectorSetupResult = (result: ConnectorSetupResult): string => {
  return [
    "",
    "Connector setup result:",
    `URL: ${result.connectorUrl}`,
    `Submitted: ${result.completed ? "yes" : "no"}`,
    ...(result.steps.length > 0 ? ["", "Steps:", ...result.steps.map((step) => `- ${step}`)] : []),
    ...(result.warnings.length > 0
      ? ["", "Needs manual attention:", ...result.warnings.map((warning) => `- ${warning}`)]
      : []),
    "",
    "Automatic startup handles this on each restart when the browser is connected. Manual fallback: ChatGPT Settings -> Apps -> Advanced settings -> Create app, paste the Connector URL, choose no authentication, then enable it in Developer Mode for this chat.",
  ].join("\n");
};

const printAttachmentTable = (attachments: Attachment[]): void => {
  if (attachments.length === 0) {
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
    console.log(formatTableRow({ row, widths }));
  }
};

const computeColumnWidths = (rows: string[][]): number[] => {
  const header = rows[0];
  if (header === undefined) return [];
  return header.map((...args: [string, number]) => maxColumnLength({ rows, column: args[1] }));
};

const maxColumnLength = (input: { rows: string[][]; column: number }): number => {
  return Math.max(
    ...input.rows.map((row) => {
      const cell = row[input.column];
      if (cell === undefined) return 0;
      return cell.length;
    }),
  );
};

const formatTableRow = (input: { row: string[]; widths: number[] }): string => {
  return input.row
    .map((...args: [string, number]) =>
      padTableCell({ cell: args[0], column: args[1], widths: input.widths }),
    )
    .join("  ");
};

const padTableCell = (input: { cell: string; column: number; widths: number[] }): string => {
  const width = input.widths[input.column];
  if (width === undefined) return input.cell;
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
  if (input.current !== undefined && input.current !== null) input.args.push(input.current);
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
    if (input.current !== undefined && input.current !== null) input.args.push(input.current);
    return { current: "", quote: input.quote };
  }
  return { current: input.current + input.char, quote: input.quote };
};

type RuntimeOrchestrator = {
  page?: Page | null;
};

const currentPage = (ctx: CommandContext): Page | undefined => {
  const orchestrator = ctx.orchestrator as CommandContext["orchestrator"] & RuntimeOrchestrator;
  if (orchestrator.page === null || orchestrator.page === undefined) return undefined;
  return orchestrator.page;
};

const conversationIdFromPage = (page: Page): string => {
  const conversationId = chatGptConversationIdFromUrl(page.url());
  if (conversationId === undefined || conversationId === null) return "current";
  return conversationId;
};

const parseOutDir = (args: string[]): string | undefined => {
  const outIndex = args.indexOf("--out");
  if (outIndex === -1) return undefined;
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
  if (id === undefined || id === "") {
    printError("Usage: download <attachment-id>");
    return;
  }
  if (!input.input.manifestIds.includes(id)) {
    printError(`No attachment with id "${id}".`);
    return;
  }
  const downloaded = await downloadAttachment(input.input.page, input.input.conversationId, id, {
    repoRoot: input.input.repoRoot,
    manifestRoot: downloadsDir(input.input.repoRoot),
    ...(input.outDir ? { outDir: input.outDir } : {}),
  });
  console.log(downloaded.path);
};

const printBulkDownloadResults = (
  results: ReadonlyArray<{ id: string; path: string; bytes: number; error?: string }>,
): void => {
  const succeeded = results.filter((item) => item.error === undefined).length;
  const failed = results.length - succeeded;
  let summary = `Downloaded ${succeeded}/${results.length} attachments`;
  if (failed > 0) summary = `${summary} (${failed} failed)`;
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
    routeFilesCommand({ args: args[0], ctx: args[1] }),
};

const routeFilesCommand = async (input: { args: string; ctx: CommandContext }): Promise<void> => {
  const context = await loadFilesContext(input);
  const parts = splitArgs(input.args);
  if (parts.length === 0) return printAttachmentTable(context.manifest.attachments);
  await routeFilesDownload({ parts, context });
};

const loadFilesContext = async (input: { args: string; ctx: CommandContext }) => {
  const page = currentPage(input.ctx);
  const conversationId = page ? conversationIdFromPage(page) : "current";
  const manifest = await loadManifest(conversationId, {
    manifestRoot: downloadsDir(input.ctx.config.repoPath),
  });
  return { page, conversationId, manifest, repoRoot: input.ctx.config.repoPath };
};

const routeFilesDownload = async (input: {
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

const sessionStore = (repoPath: string): SessionStoreOptions => {
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

const sessionIdFrom = async (params: SessionIdInput): Promise<string | null> => {
  const [requested] = splitArgs(params.args);
  if (requested) return requested;
  if (params.ctx.session?.getId()) return params.ctx.session.getId();
  const latest = await getLatestSession(sessionStore(params.ctx.config.repoPath));
  if (latest === null) return null;
  return latest.metadata.id;
};

type RepositoryFileInput = {
  repoRoot: string;
  input: string;
};

const repositoryFileFrom = (params: RepositoryFileInput): string => {
  if (isAbsolute(params.input)) {
    const rel = relative(resolve(params.repoRoot), resolve(params.input));
    return repositoryPath(params.repoRoot, rel || ".");
  }
  return repositoryPath(params.repoRoot, params.input);
};

const assertImagePath = (path: string): void => {
  const extension = extname(path).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extension)) {
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
  if (!["http:", "https:"].includes(parsed.protocol)) {
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

const sessionExportFromArgs = async (
  params: ResolveSessionExportParams,
): Promise<SessionExportSelection> => {
  const parts = splitArgs(params.args);
  if (parts.length === 0) {
    return { sessionId: await sessionIdFrom({ args: "", ctx: params.ctx }) };
  }
  return sessionExportFromParts({ parts, ctx: params.ctx });
};

const sessionExportFromParts = async (input: {
  parts: string[];
  ctx: CommandContext;
}): Promise<SessionExportSelection> => {
  const first = input.parts[0] === undefined ? "" : input.parts[0];
  const store = sessionStore(input.ctx.config.repoPath);
  const session = await tryLoadSession({ sessionId: first, options: store });
  if (session !== undefined && session !== null) {
    return {
      sessionId: session.metadata.id,
      outputPath: input.parts[1] ? resolve(input.parts[1]) : undefined,
    };
  }
  return {
    sessionId: await sessionIdFrom({ args: "", ctx: input.ctx }),
    outputPath: resolve(first),
  };
};

const defaultExportPath = (params: { repoPath: string; sessionId: string }): string => {
  return join(exportsDir(params.repoPath), `${params.sessionId}.md`);
};

const exportContentForPath = (params: { path: string; exported: SessionExport }): string => {
  const extension = extname(params.path).toLowerCase();
  if (extension === ".json") return params.exported.json;
  if (extension === ".jsonl") return params.exported.jsonl;
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
  console.log(formatBridgeStatus(ctx));
};

const showStatuslineCommand = async (_args: string, ctx: CommandContext): Promise<void> => {
  console.log(formatBridgeStatus(ctx));
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
  process.exit(0);
};

const showHelpCommand = async (_args: string, ctx: CommandContext): Promise<void> => {
  const all = registeredCommands();
  console.log("\nAvailable commands:\n");
  for (const cmd of all) {
    console.log(`  /${cmd.name.padEnd(16)} ${cmd.description}`);
  }
  await printCustomCommands(ctx);
  console.log("");
};

const printCustomCommands = async (ctx: CommandContext): Promise<void> => {
  const custom = await loadCustomCommands({ repoRoot: ctx.config.repoPath });
  if (custom.length === 0) return;
  console.log("\nCustom commands:\n");
  for (const cmd of custom) {
    const description = cmd.description === undefined ? `${cmd.source} command` : cmd.description;
    console.log(`  /${cmd.name.padEnd(16)} ${description}`);
  }
};

const listCustomCommandsCommand = async (_args: string, ctx: CommandContext): Promise<void> => {
  const custom = await loadCustomCommands({ repoRoot: ctx.config.repoPath });
  if (custom.length === 0) {
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
  if (!target) {
    console.log("Usage: /attach-image <repo-relative-image-path>");
    return;
  }
  await attachRepoImage({ target, ctx });
};

const attachRepoImage = async (input: { target: string; ctx: CommandContext }): Promise<void> => {
  const imagePath = repositoryFileFrom({
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
  if (!url) {
    console.log("Usage: /screenshot <url>");
    return;
  }
  const files = await captureUrlScreenshots({ url, repoPath: ctx.config.repoPath });
  printScreenshotPaths(files);
};

const runUiQaCommand = async (args: string, ctx: CommandContext): Promise<void> => {
  const url = args.trim();
  if (!url) {
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
  if (args.trim()) {
    await openMatchingConversation({ query: args.trim(), ctx });
    return;
  }
  const conversations = await ctx.orchestrator.listConversations();
  if (conversations.length === 0) {
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
  if (match !== undefined && match !== null) {
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
  const sessions = await listSessions(sessionStore(ctx.config.repoPath));
  if (sessions.length === 0) {
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
      `${marker} ${session.id.padEnd(38)} ${session.updatedAt} ${sessionModelLabel(session.model)} ${session.repoPath}`,
    );
  }
  console.log("\nUse /resume --last or /resume <session-id> to make a session current.\n");
};

const resumeSessionCommand = async (args: string, ctx: CommandContext): Promise<void> => {
  const query = args.trim();
  if (query === undefined || query === "") {
    console.log(
      "Usage: /resume <number|title|id> or /resume --last (use /conversations or /sessions)",
    );
    return;
  }
  if (query === "--last") {
    await resumeLatestSession(ctx);
    return;
  }
  if (await resumeLocalSession({ query, ctx })) return;
  await resumeBrowserConversation({ query, ctx });
};

const resumeLatestSession = async (ctx: CommandContext): Promise<void> => {
  const latest = await getLatestSession(sessionStore(ctx.config.repoPath));
  if (!latest) {
    console.log("No local bridge sessions found.");
    return;
  }
  await ctx.session?.setId(latest.metadata.id);
  console.log(formatSessionSummary(latest.metadata, ctx.session?.getId()));
};

type ResumeLocalSessionParams = {
  query: string;
  ctx: CommandContext;
};

const resumeLocalSession = async (params: ResumeLocalSessionParams): Promise<boolean> => {
  const localSession = await tryLoadSession({
    sessionId: params.query,
    options: sessionStore(params.ctx.config.repoPath),
  });
  if (!localSession) return false;
  await params.ctx.session?.setId(localSession.metadata.id);
  console.log(formatSessionSummary(localSession.metadata, params.ctx.session?.getId()));
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
  if (!target) {
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
  if (Number.isNaN(num)) {
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
  const sessionId = await sessionIdFrom({ args, ctx });
  if (!sessionId) {
    console.log("No local session selected. Use /sessions first.");
    return;
  }
  const exported = await exportSession(sessionId, sessionStore(ctx.config.repoPath));
  console.log(trimOutput(exported.transcript || "(empty transcript)", 40_000));
};

const copyTranscriptCommand = async (args: string, ctx: CommandContext): Promise<void> => {
  const sessionId = await sessionIdFrom({ args, ctx });
  if (!sessionId) {
    console.log("No local session selected. Use /sessions first.");
    return;
  }
  const exported = await exportSession(sessionId, sessionStore(ctx.config.repoPath));
  await copyTextToClipboard(exported.transcript);
  console.log(`Copied transcript for ${sessionId} to clipboard.`);
};

const exportTranscriptCommand = async (args: string, ctx: CommandContext): Promise<void> => {
  const selection = await sessionExportFromArgs({ args, ctx });
  if (!selection.sessionId) {
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
  const store = sessionStore(params.ctx.config.repoPath);
  const exported = await exportSession(params.sessionId, store);
  const targetPath =
    params.outputPath === undefined
      ? defaultExportPath({ repoPath: params.ctx.config.repoPath, sessionId: params.sessionId })
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
  if (checkpoints.length === 0) {
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
      `  ${checkpoint.id.padEnd(38)} ${checkpoint.phase.padEnd(6)} ${checkpoint.fileCount} files ${checkpointLabel(checkpoint.label)}`,
    );
  }
  console.log("\nUse /restore <checkpoint-id> or /rewind --files <checkpoint-id>.\n");
};

const checkpointLabel = (label: string | undefined): string => {
  if (label === undefined) return "";
  return label;
};

const restoreCheckpointCommand = async (args: string, ctx: CommandContext): Promise<void> => {
  const parts = splitArgs(args);
  const checkpointId = parts[0];
  if (!checkpointId) {
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

const rewindPromptCommand = async (args: string, ctx: CommandContext): Promise<void> => {
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
  if (!checkpointId) {
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
  if (params.mode === "--files") return;
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
  rewind: rewindPromptCommand,
};

const providerLacksMcpConnector = (ctx: CommandContext): boolean => {
  return !providerFor(ctx.config.provider).supportsMcpConnector;
};

const showMcpCommand = async (_args: string, ctx: CommandContext): Promise<void> => {
  if (providerLacksMcpConnector(ctx)) {
    printNoMcpDiagnostics(ctx);
    return;
  }
  console.log(formatMcpDiagnostics(ctx));
};

const printNoMcpDiagnostics = (ctx: CommandContext): void => {
  const label = providerDisplayName(providerIdFrom(ctx.config.provider));
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
  if (providerLacksMcpConnector(ctx)) {
    printNoConnectorWarning(ctx);
    return;
  }
  const connector = mcpConnectorUrl(ctx.config.tunnelUrl);
  if (!connector) {
    printMissingConnectorUrl(ctx);
    return;
  }
  await openConnectorSetup({ connector, ctx });
};

const printNoConnectorWarning = (ctx: CommandContext): void => {
  const label = providerDisplayName(providerIdFrom(ctx.config.provider));
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
  console.log(formatMcpDiagnostics(params.ctx));
  if (!params.ctx.orchestrator.openConnectorSetup) {
    console.log(
      "\nBrowser setup automation is unavailable. Open ChatGPT Settings -> Apps -> Advanced settings -> Create app and paste the Connector URL.",
    );
    return;
  }
  const setupResult = await params.ctx.orchestrator.openConnectorSetup({
    connectorUrl: params.connector,
  });
  console.log(formatConnectorSetupResult(setupResult));
};

const permissionsCommand = async (args: string, ctx: CommandContext): Promise<void> => {
  const next = args.trim();
  if (!next) {
    printPermissionModes(ctx);
    return;
  }
  await setPermissionMode({ next, ctx });
};

const printPermissionModes = (ctx: CommandContext): void => {
  console.log(`Permission mode: ${statusPermissionLabel(ctx)}`);
  console.log(`Available: ${PERMISSION_MODES.join(", ")}`);
};

const setPermissionMode = async (params: { next: string; ctx: CommandContext }): Promise<void> => {
  const mode = normalizePermissionMode(params.next);
  if (mode !== params.next) {
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
  if (!task) {
    console.log("Usage: /task <project task>");
    return;
  }
  if (providerLacksMcpConnector(ctx)) {
    printNoMcpTaskWarning(ctx);
    return;
  }
  const instructions = await loadProjectInstructions(ctx.config.repoPath);
  await ctx.sendMessage(projectTaskPromptWithInstructions(task, ctx, instructions.promptText));
};

const printNoMcpTaskWarning = (ctx: CommandContext): void => {
  const label = providerDisplayName(providerIdFrom(ctx.config.provider));
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
  permissions: permissionsCommand,
  mcp: showMcpCommand,
  connector: openConnectorCommand,
  review: runReviewCommand,
};

const modelCommand = async (args: string, ctx: CommandContext): Promise<void> => {
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
  if (available.length > 0) {
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
  model: modelCommand,
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
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Command /${input.parsed.name} failed: ${message}`);
  }
  return true;
};

const executeCustomCommand = async (input: {
  parsed: { name: string; args: string };
  ctx: CommandContext;
}): Promise<boolean> => {
  const custom = await findCustomCommand({ name: input.parsed.name, ctx: input.ctx });
  if (!custom) return false;
  await input.ctx.sendMessage(renderCustomCommandPrompt(custom, input.parsed.args));
  return true;
};

const parseCommandInput = (input: string): { name: string; args: string } | null => {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const { name, args } = splitCommandNameAndArgs(trimmed);
  if (!name) return null;
  return { name, args };
};

const splitCommandNameAndArgs = (trimmed: string): { name: string; args: string } => {
  const spaceIdx = trimmed.indexOf(" ");
  const name = spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx);
  const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1);
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
    if (!handler) return [];
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

export const registerCommand = (cmd: CommandDef): void => {
  commands.set(cmd.name, cmd);
  canonicalNames.add(cmd.name);
  const aliases = cmd.aliases === undefined ? [] : cmd.aliases;
  for (const alias of aliases) {
    commands.set(alias, cmd);
  }
};

export const registeredCommands = (): CommandDef[] => {
  const listed: CommandDef[] = [];
  for (const name of canonicalNames) {
    const command = commands.get(name);
    if (command === undefined) continue;
    if (command.hidden) continue;
    listed.push(command);
  }
  return listed;
};

export const parseCommand = (input: string): { name: string; args: string } | null => {
  const parsed = parseCommandInput(input);
  if (!parsed || !commands.has(parsed.name)) return null;
  return parsed;
};

// Built-in first; else project/user markdown templates. Handler errors stay non-throwing for the TUI.
export const executeCommand = async (input: string, ctx: CommandContext): Promise<boolean> => {
  const parsed = parseCommandInput(input);
  if (!parsed) return false;
  const cmd = commands.get(parsed.name);
  if (!cmd) return executeCustomCommand({ parsed, ctx });
  return executeBuiltinCommand({ parsed, cmd, ctx });
};

export const matchCommands = (partial: string): CommandDef[] => {
  const q = partial.toLowerCase();
  return registeredCommands().filter((cmd) => cmd.name.toLowerCase().startsWith(q));
};

for (const command of BUILTIN_COMMANDS) {
  registerCommand(command);
}

const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

// undefined for absent/invalid so the browser layer uses its default wait.
export const timeoutMsFromSeconds = (seconds: string | undefined): number | undefined => {
  if (!seconds) return undefined;
  const parsed = Number(seconds);
  if (Number.isNaN(parsed) || parsed <= 0) return undefined;
  return Math.round(parsed * 1000);
};

// Ctrl-C / kill: stop generating before tear-down so warm tabs do not burn quota.
export const abortAndExit = async (
  engine: BridgeEngine,
  code: number,
  exit: (code: number) => never,
): Promise<void> => {
  await Promise.allSettled([engine.getOrchestrator().stopResponse()]);
  await Promise.allSettled([engine.shutdown({ closeBrowser: false })]);
  exit(code);
};

export const runSessions = async (): Promise<void> => {
  const sessions = await listSessions();
  process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
  process.exit(0);
};

export const runBrowserStatus = async (options: BrowserStatusOptions = {}): Promise<void> => {
  const status = await readBrowserStatus();
  if (options.json) process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  else process.stdout.write(`${formatBrowserDebugStatus(status)}\n`);
  process.exit(0);
};

const cacheProfileRoot = (options: CacheCmdOptions): string => {
  return options.profile ? resolve(options.profile) : bridgeChromeProfileRoot();
};

export const runCacheList = async (options: CacheCmdOptions): Promise<void> => {
  const inventory = await inventoryChromeCache({
    profileRoot: cacheProfileRoot(options),
  });
  if (options.json) process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
  else process.stdout.write(`${formatCacheInventory(inventory)}\n`);
  process.exit(0);
};

export const runCachePrune = async (options: CacheCmdOptions): Promise<void> => {
  const dryRun = options.dryRun === undefined ? !options.yes : options.dryRun;
  if (!dryRun) await assertChromeClosedForCachePrune();
  const pruneResult = await pruneChromeCache({
    profileRoot: cacheProfileRoot(options),
    dryRun,
    confirm: options.yes,
  });
  if (options.json) process.stdout.write(`${JSON.stringify(pruneResult, null, 2)}\n`);
  else process.stdout.write(`${formatCachePruneResult(pruneResult)}\n`);
  process.exit(0);
};

const assertChromeClosedForCachePrune = async (): Promise<void> => {
  const status = await readBrowserStatus();
  if (!status.chromeRunning) return;
  fail("Quit Chrome before pruning generated cache from the shared bridge profile.");
};

const killDebugPort = (port: number): Promise<boolean> => {
  return new Promise((resolveKill) => {
    execFile("lsof", ["-ti", `tcp:${port}`], (...args: [Error | null, string]) => {
      resolveKill(killPidsFromStdout(args[1]));
    });
  });
};

const killPidsFromStdout = (stdout: string): boolean => {
  const pids = stdout.trim().split(/\s+/).filter(Boolean);
  if (pids.length === 0) return false;
  for (const pid of pids) killPidBestEffort(pid);
  return true;
};

const killPidBestEffort = (pid: string): void => {
  try {
    process.kill(Number(pid));
  } catch {
    // process already gone
  }
};

const assertSignedIn = async (
  engine: Awaited<ReturnType<typeof startEngine>>,
  browserProvider: ReturnType<typeof providerFor>,
  provider: ReturnType<typeof providerIdFrom>,
): Promise<void> => {
  const browser = engine.browser;
  if (!browser) {
    await engine.shutdown({ closeBrowser: false });
    return fail(
      `Browser not connected. Run \`bridge chrome start --provider ${provider}\` and sign in if needed.`,
    );
  }
  try {
    await browserProvider.assertSignedIn(browser.getPage());
  } catch (err) {
    await engine.shutdown({ closeBrowser: false });
    fail(err instanceof Error ? err.message : String(err));
  }
};

type WriteAskOutputContext = {
  engine: Awaited<ReturnType<typeof startEngine>>;
  reply: Awaited<ReturnType<Awaited<ReturnType<typeof startEngine>>["ask"]>>;
  orchestratorError: string | null;
  options: AskOptions;
  provider: ReturnType<typeof providerIdFrom>;
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
      })}\n`,
    );
    return;
  }
  process.stdout.write(`${ctx.reply.content}\n`);
};

type StartAskEngineInput = {
  options: AskOptions;
  provider: ReturnType<typeof providerIdFrom>;
  supportsMcpConnector: boolean;
};

const runAskFlow = async (input: { prompt: string; options: AskOptions }): Promise<void> => {
  if (input.options.fanOut) return runFanoutSource(input.options);
  if (!input.prompt.trim()) {
    return fail('Provide a prompt (e.g. `bridge ask "hi"`) or a task file via --fan-out.');
  }
  const providers = providerListOrFail(input.options.provider);
  if (providers.length > 1) {
    return fanOutPromptAcrossProviders({
      prompt: input.prompt,
      providers,
      options: input.options,
    });
  }
  const setup = await prepareAskRun(input.options);
  const captured = captureOrchestratorError(setup.engine);
  const reply = await runAskTurn({
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

const providerListOrFail = (spec: string | undefined): BridgeProviderId[] => {
  try {
    return providerIdsFrom(spec);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
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
  await runFanoutAndReport({
    tasks,
    provider: input.providers[0] === undefined ? DEFAULT_PROVIDER : input.providers[0],
    options: input.options,
  });
};

const runFanoutSource = async (options: AskOptions): Promise<void> => {
  const fanOutSpec = options.fanOut === undefined ? "" : options.fanOut;
  const tasks = await loadFanoutTasks(fanOutSpec);
  await runFanoutAndReport({ tasks, provider: providerIdFrom(options.provider), options });
};

const readFanoutSource = async (spec: string): Promise<string> => {
  const trimmed = spec.trim();
  if (trimmed.startsWith("[")) return trimmed;
  const path = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  const absolute = isAbsolute(path) ? path : resolve(process.cwd(), path);
  return readFile(absolute, "utf8");
};

const loadFanoutTasks = async (spec: string): Promise<readonly FanoutTask[]> => {
  if (!spec.trim()) return fail("--fan-out needs a task file, @file, or inline JSON array.");
  const raw = await readFanoutSource(spec).catch((err: unknown) =>
    fail(`--fan-out could not read ${spec}: ${err instanceof Error ? err.message : String(err)}`),
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return fail(`--fan-out is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    return Schema.decodeUnknownSync(FanoutTasksSchema)(parsed);
  } catch (err) {
    return fail(
      `--fan-out does not match the task schema (need a non-empty array of {prompt, provider?, conversation?, label?, isolate?}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
};

const runFanoutAndReport = async (input: {
  tasks: readonly FanoutTask[];
  provider: BridgeProviderId;
  options: AskOptions;
}): Promise<void> => {
  const engine = await startAskEngine({
    options: { ...input.options, provider: input.provider },
    provider: input.provider,
    supportsMcpConnector: false,
  });
  try {
    if (!engine.browser) {
      return fail(
        `Browser not connected. Run \`bridge chrome start --provider ${input.provider}\` and sign in if needed.`,
      );
    }
    const fanoutResult = await fanOutConversations({
      browser: engine.browser,
      config: engine.config,
      tasks: input.tasks,
      manifestRoot: attachmentManifestsDir(),
      options: fanoutOptionsFromAsk(input.options),
    });
    writeFanoutOutput(fanoutResult, input.options);
    await Promise.allSettled([engine.shutdown({ closeBrowser: false })]);
    process.exit(fanoutFailed(fanoutResult, Boolean(input.options.strict)) ? 1 : 0);
  } catch (err) {
    await Promise.allSettled([engine.shutdown({ closeBrowser: false })]);
    return fail(err instanceof Error ? err.message : String(err));
  }
};

const positiveIntFromOption = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const nonNegativeIntFromOption = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const fanoutOptionsFromAsk = (options: AskOptions): FanoutOptions => {
  const timeoutMs = timeoutMsFromSeconds(options.timeout);
  const maxConcurrency = positiveIntFromOption(options.maxConcurrency);
  const limit = positiveIntFromOption(options.limit);
  const offset = nonNegativeIntFromOption(options.offset);
  const maxReplyChars = positiveIntFromOption(options.maxReplyChars);
  return {
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(maxConcurrency ? { maxConcurrency } : {}),
    ...(limit ? { limit } : {}),
    ...(offset !== undefined ? { offset } : {}),
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
    const heading = fanoutRowHeading({ row, offset: result.offset, index });
    const target = fanoutTargetLabel(row.target);
    const truncated = row.truncated ? `, truncated from ${row.replyChars}` : "";
    const rowBody = fanoutRowBody(row);
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

const fanoutRowHeading = (input: {
  row: FanoutResult["results"][number];
  offset: number;
  index: number;
}): string => {
  if (input.row.label !== undefined && input.row.label !== "") return input.row.label;
  return `task ${input.offset + input.index + 1}`;
};

const fanoutTargetLabel = (target: FanoutResult["results"][number]["target"]): string => {
  if (target === null) return "";
  if (target.id === null || target.id === "") return ` ${target.provider}`;
  return ` ${target.provider} ${target.id}`;
};

const fanoutRowBody = (row: FanoutResult["results"][number]): string => {
  if (row.ok) {
    if (row.reply === undefined) return "";
    return row.reply;
  }
  if (row.error === undefined) return "";
  return row.error;
};

const fanOutForServe = async (
  tasks: FanoutTask[],
  batchOptions: FanoutOptions,
  base: AskOptions,
): Promise<FanoutResult> => {
  const provider = providerIdFrom(base.provider);
  const engine = await startAskEngine({
    options: { ...base, provider },
    provider,
    supportsMcpConnector: false,
  });
  try {
    if (!engine.browser) {
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
    fanOut: (tasks, opts) => fanOutForServe(tasks, opts, base),
    searchConversations: (providers, query, opts) =>
      fanoutConversationSearch(providers as BridgeProviderId[], query, base, opts),
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

const fanoutConversationSearch = async (
  providers: BridgeProviderId[],
  query: string,
  options: AskOptions,
  searchOptions: { limit?: number } = {},
): Promise<Record<string, ConversationSearchOutcome>> => {
  const outcomes = await Promise.all(
    providers.map(async (provider): Promise<readonly [string, ConversationSearchOutcome]> => {
      const started = Date.now();
      try {
        const results = await searchOneProvider(provider, query, options, searchOptions);
        return [provider, { ok: true, results, elapsedMs: Date.now() - started }];
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        return [provider, { ok: false, error, elapsedMs: Date.now() - started }];
      }
    }),
  );
  return Object.fromEntries(outcomes);
};

const searchOneProvider = async (
  provider: BridgeProviderId,
  query: string,
  options: AskOptions,
  searchOptions: { limit?: number },
): Promise<ConversationSearchResult[]> => {
  const browserProvider = providerFor(provider);
  const engine = await startAskEngine({
    options: { ...options, provider },
    provider,
    supportsMcpConnector: false,
  });
  try {
    const browser = engine.browser;
    if (!browser) {
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
    if (event.type === "error") lastError = event.error;
  });
  return { lastError: () => lastError };
};

const prepareAskRun = async (options: AskOptions) => {
  const providers = askProvidersFrom(options);
  const engine = await startAskEngine({
    options,
    provider: providers.provider,
    supportsMcpConnector: providers.browserProvider.supportsMcpConnector,
  });
  registerAskSignalHandlers(engine);
  await assertSignedIn(engine, providers.browserProvider, providers.provider);
  return { engine, ...providers };
};

const askProvidersFrom = (options: AskOptions) => {
  const provider = providerIdFrom(options.provider);
  return { provider, browserProvider: providerFor(provider) };
};

const finishAskRun = async (input: {
  setup: Awaited<ReturnType<typeof prepareAskRun>>;
  reply: Awaited<ReturnType<Awaited<ReturnType<typeof startEngine>>["ask"]>>;
  orchestratorError: string | null;
  options: AskOptions;
}): Promise<void> => {
  await input.setup.engine.shutdown({ closeBrowser: false });
  writeAskOutput({
    engine: input.setup.engine,
    reply: input.reply,
    orchestratorError: input.orchestratorError,
    options: input.options,
    provider: input.setup.provider,
    displayName: input.setup.browserProvider.displayName,
  });
  process.exit(0);
};

const startAskEngine = async (input: StartAskEngineInput) => {
  const withTools = Boolean(input.options.tools) && input.supportsMcpConnector;
  return startEngine({
    repoPath: input.options.repo ? resolve(input.options.repo) : undefined,
    provider: input.provider,
    mcpPort: input.options.port ? Number(input.options.port) : undefined,
    withBrowser: true,
    withTools,
    persist: withTools,
    debugPort: debugPortFromOption(input.options.debugPort),
    profileRoot: profileRootFromOption(input.options.profile),
  });
};

const registerAskSignalHandlers = (engine: Awaited<ReturnType<typeof startEngine>>): void => {
  process.once("SIGINT", () => void abortAndExit(engine, 130, process.exit));
  process.once("SIGTERM", () => void abortAndExit(engine, 143, process.exit));
};

const imageCountFromOption = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const debugPortFromOption = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const profileRootFromOption = (value: string | undefined): string | undefined => {
  return value ? resolve(value) : undefined;
};

const runAskTurn = async (input: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  prompt: string;
  options: AskOptions;
}) => {
  await applyAskPreflight({ engine: input.engine, options: input.options });
  await attachAskFiles({ engine: input.engine, options: input.options });
  return input.engine.ask({
    content: input.prompt,
    timeoutMs: timeoutMsFromSeconds(input.options.timeout),
    expectImages: imageCountFromOption(input.options.images),
  });
};

const attachAskFiles = async (input: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  options: AskOptions;
}): Promise<void> => {
  const paths = input.options.attach;
  if (!paths?.length) return;
  const repoRoot = input.engine.config.repoPath;
  const resolved = paths.map((target) => {
    const rel = repositoryFileFrom({ repoRoot, input: target });
    assertImagePath(rel);
    return resolve(repoRoot, rel);
  });
  await input.engine.getOrchestrator().attachFiles(resolved);
};

const conversationUrlFromOption = (value: string): string => {
  return chatGptConversationUrlFromIdOrUrl(value);
};

const navigateToConversationIfNeeded = async (input: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  conversation?: string;
  page: Page;
}): Promise<void> => {
  if (!input.conversation) return;
  const targetUrl = conversationUrlFromOption(input.conversation);
  if (isSameChatGptConversation(input.page.url(), targetUrl)) return;
  await Promise.allSettled([input.engine.getOrchestrator().navigateToConversation(targetUrl)]);
};

const applyAskPreflight = async (input: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  options: AskOptions;
}): Promise<void> => {
  if (input.options.fresh)
    await Promise.allSettled([input.engine.getOrchestrator().newConversation()]);
  else if (input.options.conversation) {
    await Promise.allSettled([
      input.engine
        .getOrchestrator()
        .navigateToConversation(conversationUrlFromOption(input.options.conversation)),
    ]);
  }
  if (input.options.model)
    await Promise.allSettled([input.engine.getOrchestrator().switchModel(input.options.model)]);
};

const assertDownloadProviderSupported = (options: DownloadCmdOptions): void => {
  if (providerIdFrom(options.provider) === "gemini") {
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
    const line = `${formatDownloadLine(download)}
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
  return ids.length > 0 ? ids : undefined;
};

export const formatDownloadLine = (result: DownloadResult): string => {
  const label = result.id === undefined || result.id === "" ? "attachment" : result.id;
  if (result.error !== undefined) return `${label}: ${result.error}`;
  return `${label} -> ${result.path} (${result.bytes} bytes)`;
};

export const runDownload = async (options: DownloadCmdOptions): Promise<void> => {
  assertDownloadProviderSupported(options);
  const results = await runDownloadFlow(options);
  writeDownloadOutput(results, options.json);
  process.exit(0);
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
    conversationId:
      options.conversation === undefined ? conversationIdFromPage(page) : options.conversation,
    options,
  };
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
    provider: providerIdFrom(options.provider),
    mcpPort: options.port ? Number(options.port) : undefined,
    withBrowser: true,
    withTools: false,
    persist: false,
    debugPort: debugPortFromOption(options.debugPort),
    profileRoot: profileRootFromOption(options.profile),
  });
};

const requireBrowserPage = (engine: Awaited<ReturnType<typeof startEngine>>): Page => {
  const browser = engine.browser;
  if (!browser) {
    void engine.shutdown({ closeBrowser: false });
    return fail(
      "Browser not connected. Run `bridge chrome start` and sign in to ChatGPT if needed.",
    );
  }
  return browser.getPage();
};

const assertChatgptWorkspace = (options: CliOptions): void => {
  if (providerIdFrom(options.provider) !== "chatgpt") {
    fail(
      "Projects, chat moves, and Scheduled tasks are ChatGPT-only. Omit --provider or pass --provider chatgpt.",
    );
  }
};

const startWorkspaceSession = async (options: CliOptions & BrowserTargetOptions) => {
  const engine = await startEngine({
    repoPath: options.repo ? resolve(options.repo) : undefined,
    provider: "chatgpt",
    mcpPort: options.port ? Number(options.port) : undefined,
    withBrowser: true,
    withTools: false,
    debugPort: debugPortFromOption(options.debugPort),
    profileRoot: profileRootFromOption(options.profile),
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
  process.exit(0);
};

export const runProjectCreate = async (name: string, options: ProjectCmdOptions): Promise<void> => {
  assertChatgptWorkspace(options);
  if (!name.trim()) fail("Usage: bridge project create <name>");
  const { engine, page } = await startWorkspaceSession(options);
  const project = await createProject(page, name);
  await engine.shutdown({ closeBrowser: false });
  if (options.json) process.stdout.write(`${JSON.stringify(project)}\n`);
  else process.stdout.write(`Created project: ${project.name}\n`);
  process.exit(0);
};

export const runProjectRename = async (name: string, options: ProjectCmdOptions): Promise<void> => {
  assertChatgptWorkspace(options);
  const to = options.to?.trim();
  if (!name.trim() || !to) return fail("Usage: bridge project rename <name> --to <newName>");
  const { engine, page } = await startWorkspaceSession(options);
  const outcome = await renameProject(page, { project: name, name: to });
  await engine.shutdown({ closeBrowser: false });
  if (options.json) process.stdout.write(`${JSON.stringify(outcome)}\n`);
  else if (outcome.renamed)
    process.stdout.write(`Renamed "${outcome.project}" -> ${outcome.renamedTo}\n`);
  else process.stdout.write(`Skipped "${outcome.project}": ${outcome.reason}\n`);
  process.exit(outcome.renamed ? 0 : 1);
};

export const runProjectDelete = async (name: string, options: ProjectCmdOptions): Promise<void> => {
  assertChatgptWorkspace(options);
  if (!name.trim()) return fail("Usage: bridge project delete <name> --yes");
  if (!options.yes) {
    return fail(
      `Refusing to delete project "${name}" without --yes; this permanently deletes its chats.`,
    );
  }
  const { engine, page } = await startWorkspaceSession(options);
  const outcome = await deleteProject(page, name);
  await engine.shutdown({ closeBrowser: false });
  if (options.json) process.stdout.write(`${JSON.stringify(outcome)}\n`);
  else if (outcome.deleted) process.stdout.write(`Deleted project "${outcome.project}"\n`);
  else process.stdout.write(`Skipped "${outcome.project}": ${outcome.reason}\n`);
  process.exit(outcome.deleted ? 0 : 1);
};

export const runChatList = async (options: ChatCmdOptions): Promise<void> => {
  assertChatgptWorkspace(options);
  const { engine } = await startWorkspaceSession(options);
  const chats = await engine.getOrchestrator().listConversations();
  await engine.shutdown({ closeBrowser: false });
  if (options.json) process.stdout.write(`${JSON.stringify(chats)}\n`);
  else if (chats.length === 0) process.stdout.write("No conversations.\n");
  else for (const chat of chats) process.stdout.write(`${chat.id}\t${chat.title}\n`);
  process.exit(0);
};

export const runChatSearch = async (query: string, options: ChatCmdOptions): Promise<void> => {
  assertChatgptWorkspace(options);
  if (!query.trim()) fail("Usage: bridge chat search <query>");
  const { engine } = await startWorkspaceSession(options);
  const results = await engine.getOrchestrator().searchConversations({
    query,
    limit: limitFromOption(options.limit),
  });
  await maybeOpenSearchMatch({ engine, results, open: Boolean(options.open) });
  await engine.shutdown({ closeBrowser: false });
  writeChatSearchOutput(results, options);
  process.exit(results.length > 0 ? 0 : 1);
};

const limitFromOption = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const maybeOpenSearchMatch = async (input: {
  engine: Awaited<ReturnType<typeof startWorkspaceSession>>["engine"];
  results: ConversationSearchResult[];
  open: boolean;
}): Promise<void> => {
  const [best] = input.results;
  if (!input.open || !best) return;
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
  if (results.length === 0) {
    process.stdout.write("No matching conversations.\n");
    return;
  }
  for (const hit of results) {
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
    else process.stdout.write(`Skipped "${outcome.chat}": ${outcome.reason}\n`);
  }
};

export const runChatMove = async (chat: string, options: ChatCmdOptions): Promise<void> => {
  assertChatgptWorkspace(options);
  const project = options.project?.trim();
  const targets = chatTargetsFrom(chat, options);
  if (targets.length === 0 || !project) {
    return fail("Usage: bridge chat move <idOrTitle> --project <name>  (multiple: --id <id...>)");
  }
  const { engine, page } = await startWorkspaceSession(options);
  const outcomes: MoveChatOutcome[] = [];
  for (const target of targets) {
    outcomes.push(await moveChatToProject(page, { chat: target, project }));
  }
  await engine.shutdown({ closeBrowser: false });
  writeMoveOutcomes(outcomes, options);
  process.exit(outcomes.every((outcome) => outcome.moved) ? 0 : 1);
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
  const targets = chatTargetsFrom(chat, options);
  if (targets.length === 0) {
    return fail("Usage: bridge chat archive <idOrTitle>  (multiple: --id <id...>)");
  }
  const { engine, page } = await startWorkspaceSession(options);
  const outcomes: ArchiveChatOutcome[] = [];
  for (const target of targets) {
    outcomes.push(await archiveChat(page, target));
  }
  await engine.shutdown({ closeBrowser: false });
  writeArchiveOutcomes(outcomes, options);
  process.exit(outcomes.every((outcome) => outcome.archived) ? 0 : 1);
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
  process.exit(0);
};

export const runTaskCreate = async (prompt: string, options: TaskCmdOptions): Promise<void> => {
  assertChatgptWorkspace(options);
  if (!prompt.trim()) fail("Usage: bridge task create <prompt> [--every <spec> | --at <spec>]");
  const { engine } = await startWorkspaceSession(options);
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

export const runChromeStart = async (options: ChromeStartOptions = {}): Promise<void> => {
  await launchChromeBrowser(options);
  writeChromeStartInstructions(providerFor(providerIdFrom(options.provider)).displayName);
  process.exit(0);
};

const launchChromeBrowser = async (options: ChromeStartOptions): Promise<BrowserSession> => {
  const provider = providerIdFrom(options.provider);
  const browser = new BrowserSession(provider, {
    debugPort: debugPortFromOption(options.debugPort),
    profileRoot: profileRootFromOption(options.profile),
  });
  await browser.launch();
  return browser;
};

const writeChromeStartInstructions = (displayName: string): void => {
  process.stderr.write(
    `Chrome is open for ${displayName} with the bridge debug port.
This uses the shared bridge Chrome profile, so sign in once in this window and every repo can reuse it.
Leave this Chrome window open; \`bridge ask\` will reconnect to it.
`,
  );
};

export const runStop = async (): Promise<void> => {
  const killed = await killDebugPort(BRIDGE_DEBUG_PORT);
  process.stderr.write(
    killed ? "Closed the bridge browser.\n" : "No bridge browser was running.\n",
  );
  process.exit(0);
};

const runTui = async (opts: CliOptions & { browser?: boolean }): Promise<void> => {
  if (!process.stdout.isTTY) {
    process.stderr.write(
      "bridge: the interactive TUI needs a TTY. Use `bridge ask <prompt>` for non-interactive or piped use.\n",
    );
    process.exit(1);
  }
  const provider = providerIdFrom(opts.provider);
  const label = providerDisplayName(provider);
  console.log(`\nStarting ai-browser-bridge (${label})...`);
  const engine = await startEngine({
    repoPath: opts.repo ? resolve(opts.repo) : undefined,
    provider,
    mcpPort: opts.port ? Number(opts.port) : undefined,
    withBrowser: opts.browser !== false,
    withTools: provider === "chatgpt",
    log: (line) => console.error(line),
  });
  await renderTui(engine);
};

const renderTui = async (engine: Awaited<ReturnType<typeof startEngine>>): Promise<void> => {
  const messages: Message[] = [];
  attachOrchestratorListener({ engine, messages });
  const shutdown = shutdownHandlerFor(engine);
  registerShutdownSignals(shutdown);
  const app = renderBridgeApp({ engine, messages, shutdown });
  await app.waitUntilExit();
};

const attachOrchestratorListener = (input: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  messages: Message[];
}): void => {
  input.engine.getOrchestrator().on((event) => {
    if (event.type === "message") input.messages.push(event.message);
    if (event.type === "conversation_synced") {
      input.messages.length = 0;
      input.messages.push(...event.messages);
    }
    if (event.type === "reset") input.messages.length = 0;
    if (event.type === "error") {
      input.messages.push({
        id: crypto.randomUUID(),
        role: "assistant",
        content: `⚠ ${event.error}`,
        timestamp: Date.now(),
      });
    }
  });
};

const shutdownHandlerFor = (engine: Awaited<ReturnType<typeof startEngine>>) => {
  return async (code = 0): Promise<void> => {
    await Promise.allSettled([engine.getOrchestrator().stopResponse()]);
    await engine.shutdown({ closeBrowser: false });
    process.exit(code);
  };
};

const registerShutdownSignals = (shutdown: (code?: number) => Promise<void>): void => {
  process.once("SIGINT", () => void shutdown(130));
  process.once("SIGTERM", () => void shutdown(143));
};

const renderBridgeApp = (input: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  messages: Message[];
  shutdown: (code?: number) => Promise<void>;
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
      shutdown: () => input.shutdown(0),
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
  const { engine, page } = await startWorkspaceSession(options);
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

const startFlowSession = async (options: FlowCmdOptions) => {
  const engine = await startEngine({
    repoPath: options.repo ? resolve(options.repo) : undefined,
    provider: "flow",
    mcpPort: options.port ? Number(options.port) : undefined,
    withBrowser: true,
    withTools: false,
    debugPort: debugPortFromOption(options.debugPort),
    profileRoot: profileRootFromOption(options.profile),
  });
  return { engine, page: requireBrowserPage(engine) };
};

const defaultFlowOutDir = (repoRoot: string): string => join(downloadsDir(repoRoot), "flow");

const requireClipId = (options: FlowCmdOptions, verb: string): string => {
  const id = options.id?.[0];
  if (id === undefined || id === "") return fail(`Usage: bridge flow ${verb} --id <clipId>`);
  return id;
};

export const runFlowClips = async (options: FlowCmdOptions): Promise<void> => {
  const { engine, page } = await startFlowSession(options);
  const clips = await listClips(page);
  await engine.shutdown({ closeBrowser: false });
  if (options.json) process.stdout.write(`${JSON.stringify(clips)}\n`);
  else if (clips.length === 0) process.stdout.write("No clips in the current Flow project.\n");
  else for (const clip of clips) process.stdout.write(`${clip.id}\t${clip.url}\n`);
  process.exit(0);
};

export const runFlowProjects = async (options: FlowCmdOptions): Promise<void> => {
  const { engine, page } = await startFlowSession(options);
  const projects = await listFlowProjects(page);
  await engine.shutdown({ closeBrowser: false });
  if (options.json) process.stdout.write(`${JSON.stringify(projects)}\n`);
  else if (projects.length === 0) process.stdout.write("No Flow projects.\n");
  else for (const project of projects) process.stdout.write(`${project.id}\t${project.title}\n`);
  process.exit(0);
};

export const runFlowDownload = async (options: FlowCmdOptions): Promise<void> => {
  const { engine, page } = await startFlowSession(options);
  const clips = await listClips(page);
  const targets = options.id && options.id.length > 0 ? options.id : clips.map((clip) => clip.id);
  const outDir = options.out ? resolve(options.out) : defaultFlowOutDir(engine.config.repoPath);
  const results: Array<{ id: string; ok: boolean; file?: string; error?: string }> = [];
  for (const id of targets) {
    try {
      results.push({ id, ok: true, file: await downloadClip(page, id, outDir) });
    } catch (err) {
      results.push({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
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
  process.exit(results.every((download) => download.ok) ? 0 : 1);
};

export const runFlowGenerate = async (options: FlowCmdOptions): Promise<void> => {
  const startFramePath = options.start ? resolve(options.start) : "";
  const prompt = options.prompt === undefined ? "" : options.prompt.trim();
  if (!startFramePath || !prompt) {
    fail("Usage: bridge flow generate --start <imagePath> --prompt <text> [--out <dir>]");
  }
  const { engine, page } = await startFlowSession(options);
  const outDir = options.out ? resolve(options.out) : defaultFlowOutDir(engine.config.repoPath);
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
    process.exit(0);
  } catch (err) {
    await Promise.allSettled([engine.shutdown({ closeBrowser: false })]);
    return fail(err instanceof Error ? err.message : String(err));
  }
};

export const runFlowDelete = async (options: FlowCmdOptions): Promise<void> => {
  const id = requireClipId(options, "delete");
  if (!options.yes) {
    fail(
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
  process.exit(0);
};

export const runFlowRename = async (options: FlowCmdOptions): Promise<void> => {
  const id = requireClipId(options, "rename");
  const name = options.name?.trim();
  if (!name) return fail("Usage: bridge flow rename --id <clipId> --name <text>");
  const { engine, page } = await startFlowSession(options);
  await renameClip(page, id, name);
  await engine.shutdown({ closeBrowser: false });
  process.stdout.write(
    options.json ? `${JSON.stringify({ id, name })}\n` : `Renamed clip ${id} to "${name}".\n`,
  );
  process.exit(0);
};

export const runFlowExtend = async (options: FlowCmdOptions): Promise<void> => {
  const id = requireClipId(options, "extend");
  const { engine, page } = await startFlowSession(options);
  await addClipToScene(page, id);
  await engine.shutdown({ closeBrowser: false });
  process.stdout.write(
    options.json ? `${JSON.stringify({ id, addedTo: "scene" })}\n` : `Added clip ${id} to scene.\n`,
  );
  process.exit(0);
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
  process.exit(0);
};

export const runFlowProjectRename = async (options: FlowCmdOptions): Promise<void> => {
  const name = options.name?.trim();
  if (!name) return fail("Usage: bridge flow project-rename --name <text>");
  const { engine, page } = await startFlowSession(options);
  await renameFlowProject(page, name);
  await engine.shutdown({ closeBrowser: false });
  process.stdout.write(
    options.json ? `${JSON.stringify({ project: name })}\n` : `Renamed project to "${name}".\n`,
  );
  process.exit(0);
};

export const runFlowProjectDelete = async (options: FlowCmdOptions): Promise<void> => {
  if (!options.yes) {
    fail(
      "Refusing to delete a project without --yes. `bridge flow project-delete --yes` permanently deletes the current project.",
    );
  }
  const { engine, page } = await startFlowSession(options);
  await deleteFlowProject(page);
  await engine.shutdown({ closeBrowser: false });
  process.stdout.write(
    options.json ? `${JSON.stringify({ deleted: true })}\n` : "Deleted the current Flow project.\n",
  );
  process.exit(0);
};

export const runFlowIngredients = async (options: FlowCmdOptions): Promise<void> => {
  const { engine, page } = await startFlowSession(options);
  const ingredients = await listIngredients(page);
  await engine.shutdown({ closeBrowser: false });
  if (options.json) process.stdout.write(`${JSON.stringify(ingredients)}\n`);
  else if (ingredients.length === 0)
    process.stdout.write("No ingredients attached to the prompt.\n");
  else for (const item of ingredients) process.stdout.write(`${item.id}\t${item.url}\n`);
  process.exit(0);
};

export const runFlowIngredientRemove = async (options: FlowCmdOptions): Promise<void> => {
  const id = options.id?.[0];
  if (id === undefined || id === "")
    return fail("Usage: bridge flow ingredient-remove --id <mediaId>");
  const { engine, page } = await startFlowSession(options);
  await removeIngredient(page, id);
  await engine.shutdown({ closeBrowser: false });
  process.stdout.write(
    options.json ? `${JSON.stringify({ id, removed: true })}\n` : `Removed ingredient ${id}.\n`,
  );
  process.exit(0);
};

export const runFlowIngredientClear = async (options: FlowCmdOptions): Promise<void> => {
  const { engine, page } = await startFlowSession(options);
  const removed = await clearIngredients(page);
  await engine.shutdown({ closeBrowser: false });
  process.stdout.write(
    options.json ? `${JSON.stringify({ removed })}\n` : `Removed ${removed} ingredient(s).\n`,
  );
  process.exit(0);
};
