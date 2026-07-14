export type {
  AskOptions,
  ChromeStartOptions,
  DownloadCmdOptions,
  DownloadResult,
} from "../cliTypes.ts";

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { type AskGatewayDeps, serveAskGatewayStdio } from "@/features/agentGateway";
import { startEngine } from "@/features/bridge";
import type { BridgeEngine } from "@/features/bridge";
import {
  type FanoutBatchOptions,
  type FanoutBatchResult,
  FanoutBatchSchema,
  type FanoutTask,
  fanoutBatchFailed,
  runFanoutBatch,
} from "@/features/bridge";
import {
  BRIDGE_DEBUG_PORT,
  BrowserManager,
  bridgeChromeProfileRoot,
  inventoryChromeCache,
  pruneChromeCache,
  readBrowserStatus,
} from "@/features/browser";
import type { BrowserStatus, CacheInventory, PruneCacheResult } from "@/features/browser";
import type { ConversationSearchResult } from "@/features/conversationCatalog";
import { findModelProfile, listModelProfiles } from "@/features/domain";
import { PERMISSION_MODES, normalizePermissionMode } from "@/features/domain";
import type {
  Attachment,
  CommandContext,
  CommandDef,
  ConnectorSetupResult,
  Message,
} from "@/features/domain";
import { downloadAll, extractAllMessages, loadManifest } from "@/features/providers";
import {
  archiveChat,
  createProject,
  deleteProject,
  listProjects,
  listTasks,
  moveChatToProject,
  renameProject,
} from "@/features/providers";
import type { ArchiveChatOutcome, MoveChatOutcome } from "@/features/providers";
import {
  addClipToPrompt,
  addClipToScene,
  clearIngredients,
  deleteClip,
  deleteFlowProject,
  downloadClip,
  generateClipFromFrame,
  listClips,
  listFlowProjects,
  listIngredients,
  removeIngredient,
  renameClip,
  renameFlowProject,
} from "@/features/providers";
import {
  chatGptConversationIdFromUrl,
  chatGptConversationUrlFromIdOrUrl,
  isSameChatGptConversation,
} from "@/features/providers";
import {
  type ChatGptRenderState,
  readAllChatGptTabRenderStates,
  readChatGptRenderState,
} from "@/features/providers";
import {
  type BridgeProviderId,
  DEFAULT_PROVIDER,
  getBrowserProvider,
  normalizeProvider,
  parseProviderList,
} from "@/features/providers";
import { listCheckpoints, restoreCheckpoint } from "@/features/store";
import { attachmentManifestsDir, bridgeLogPath } from "@/features/store";
import { exportsDir, screenshotsDir, sessionsDir } from "@/features/store";
import {
  type SessionExport,
  type SessionStoreOptions,
  exportSession,
  getLatestSession,
  listSessions,
  loadSession,
} from "@/features/store";
import type { SessionMetadata } from "@/features/store";
import { ensureInsideRepo, toolRegistry, trimOutput } from "@/features/tools";
import {
  loadCustomCommands,
  loadProjectInstructions,
  renderCustomCommandPrompt,
} from "@/features/userConfig";
import { Schema } from "effect";
import { render } from "ink";
import type { Page } from "playwright";
import React from "react";
import type {
  AskOptions,
  BrowserStatusOptions,
  BrowserTargetOptions,
  CacheCmdOptions,
  ChatCmdOptions,
  ChatgptCmdOptions,
  ChromeStartOptions,
  CommonCliOptions,
  DownloadCmdOptions,
  DownloadResult,
  FlowCmdOptions,
  ProjectCmdOptions,
  ServeOptions,
  TaskCmdOptions,
} from "../cliTypes.ts";
import { getProviderDisplayName } from "../providerLabel.ts";
import { BridgeApp } from "../tui/App.tsx";

// --- commands/commands.config.ts ---
/** Session, transcript, and checkpoint command metadata. */
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

/** Model and context-window command metadata. */
const MODEL_COMMANDS: CommandMeta[] = [
  { name: "model", description: "Show or switch the ChatGPT model" },
  { name: "context", description: "Show context window usage" },
];

/** MCP connector, permissions, and project-task command metadata. */
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

/** Browser orchestration and terminal UI command metadata. */
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
/** Path to the lazy-loaded downloader module. */
const DOWNLOADER_MODULE = "../../providers/chatgpt/chatgptPage.ts";

const RED = "\u001b[31m";

const RESET = "\u001b[0m";

/** Slash-command metadata without handler functions. */
interface CommandMeta {
  /** Primary command name (without `/`). */
  name: string;
  /** One-line description for `/help`. */
  description: string;
  /** Optional alternate names that resolve to this command. */
  aliases?: string[];
}

// --- commands/prompts.ts ---

/**
 * Prompt templates for the project-agent commands (`/task`, `/work`).
 *
 * These build the instruction block sent to ChatGPT that forces it to drive the
 * repo through the MCP connector tools (grep_code/read_file/apply_patch/…) rather
 * than guessing from memory. Kept separate from the command registry so the large
 * static prompt text lives with the other command data, not the dispatch logic.
 */

/**
 * Build the project-agent wrapper used by `/task` and `/work` (no instruction files).
 *
 * @param task - Task value.
 * @param ctx - Context values for the operation.
 * @returns The `buildProjectTaskPrompt` result.
 * @example
 * ```ts
 * const result = buildProjectTaskPrompt(task, ctx);
 * ```
 */
export const buildProjectTaskPrompt = (task: string, ctx: CommandContext): string => {
  return buildProjectTaskPromptWithInstructions(task, ctx, "");
};

/**
 * Build the project-agent prompt, optionally appending the repo's instruction
 * files (AGENTS.md / CLAUDE.md) so ChatGPT honours project conventions.
 *
 * The prompt deliberately front-loads a "prove the connector is active" step:
 * if ChatGPT answers from `/mnt/data` or asks for a zip/tree, the connector is
 * not wired up and the task should not proceed.
 *
 * @param task - Task value.
 * @param ctx - Context values for the operation.
 * @param projectInstructions - Project instructions value.
 * @returns The `buildProjectTaskPromptWithInstructions` result.
 * @example
 * ```ts
 * const result = buildProjectTaskPromptWithInstructions(task, ctx, projectInstructions);
 * ```
 */
export const buildProjectTaskPromptWithInstructions = (
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

// --- commands/formatters.ts ---

/**
 * Pure string builders for the diagnostic/status commands (`/status`, `/mcp`,
 * `/connector`, `/resume`). Separated from the command registry so the dispatch
 * layer stays small and these display helpers can be unit-tested in isolation.
 * None of them perform I/O — they format already-loaded context into text.
 */

/**
 * Normalise a tunnel URL into the connector endpoint ChatGPT points at.
 *
 * Returns null when no tunnel is configured (the bridge has no public URL),
 * which the callers render as "none". Accepts URLs already ending in `/mcp` or
 * `/sse` and otherwise appends `/mcp`.
 *
 * @param tunnelUrl - Tunnel url value.
 * @returns The `mcpConnectorUrl` result.
 * @example
 * ```ts
 * const result = mcpConnectorUrl(tunnelUrl);
 * ```
 */
export const mcpConnectorUrl = (tunnelUrl?: string): string | null => {
  if (!tunnelUrl) return null;
  const normalized = tunnelUrl.replace(/\/+$/, "");
  return normalized.endsWith("/mcp") || normalized.endsWith("/sse")
    ? normalized
    : `${normalized}/mcp`;
};

/**
 * Format a one-block summary of a resumed/loaded local session.
 *
 * @param session - Session value.
 * @param currentId - Current id value.
 * @returns The `formatSessionSummary` result.
 * @example
 * ```ts
 * const result = formatSessionSummary(session, currentId);
 * ```
 */
export const formatSessionSummary = (session: SessionMetadata, currentId?: string): string => {
  const marker = session.id === currentId ? "current" : "loaded";
  return [
    `Local session ${marker}: ${session.id}`,
    `Repo: ${session.repoPath}`,
    `Model: ${session.model ?? "unknown"}`,
    `Context: ${session.contextLimit.toLocaleString()} tokens`,
    `Updated: ${session.updatedAt}`,
    `Tunnel: ${session.tunnelUrl ?? "none"}`,
  ].join("\n");
};

/**
 * Format the `/status` / `/statusline` overview of the running bridge.
 *
 * @param ctx - Context values for the operation.
 * @returns The `formatBridgeStatus` result.
 * @example
 * ```ts
 * const result = formatBridgeStatus(ctx);
 * ```
 */
export const formatBridgeStatus = (ctx: CommandContext): string => {
  const connector = mcpConnectorUrl(ctx.config.tunnelUrl);
  const provider = normalizeProvider(ctx.config.provider);
  return [
    `Provider: ${provider}`,
    `Repo: ${ctx.config.repoPath}`,
    `Branch: ${ctx.statusline?.branch ?? "unknown"}`,
    `Session: ${ctx.session?.getId() ?? "none"}`,
    `Model: ${ctx.counter.modelLabel}`,
    `Context: ${ctx.counter.summary}`,
    `Permission: ${ctx.permission?.getMode() ?? ctx.config.permissionMode ?? "auto"}`,
    `Tool calls: ${ctx.statusline?.toolCallCount() ?? 0}`,
    `Tunnel: ${ctx.config.tunnelUrl ?? "none"}`,
    `Connector: ${connector ?? "none"}`,
  ].join("\n");
};

/** Format browser/debug-port state for headless `bridge status`. */
const formatBrowserDebugStatus = (status: BrowserStatus): string => {
  return [
    `State: ${status.state}`,
    `Chrome running: ${status.chromeRunning ? "yes" : "no"}`,
    `Debug port: ${status.debugPortListening ? "ready" : "closed"} (${status.port})`,
    `Can attach: ${status.canAttach ? "yes" : "no"}`,
    `Profile root: ${status.userDataDir ?? status.bridgeProfileRoot}`,
    `Message: ${status.message}`,
  ].join("\n");
};

/** Format generated Chrome cache inventory for humans. */
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

/** Format generated Chrome cache prune results for humans. */
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

/**
 * Format `/mcp` diagnostics, including exposed tools and connector-troubleshooting hints.
 *
 * @param ctx - Context values for the operation.
 * @returns The `formatMcpDiagnostics` result.
 * @example
 * ```ts
 * const result = formatMcpDiagnostics(ctx);
 * ```
 */
export const formatMcpDiagnostics = (ctx: CommandContext): string => {
  const connector = mcpConnectorUrl(ctx.config.tunnelUrl);
  const toolCallCount = ctx.statusline?.toolCallCount() ?? 0;
  return [
    "MCP bridge diagnostics:",
    `Local server: http://localhost:${ctx.config.mcpPort}`,
    `Tunnel: ${ctx.config.tunnelUrl ?? "none"}`,
    `Connector: ${connector ?? "none"}`,
    `Tools: ${[...toolRegistry.keys()].join(", ")}`,
    `Tool calls observed this session: ${toolCallCount}`,
    `Status: ${toolCallCount > 0 ? "MCP tool calls observed in this bridge session." : "No MCP tool calls observed yet; the current ChatGPT chat may not have the connector enabled."}`,
    "",
    "If ChatGPT says it cannot access local files:",
    "1. Startup automatically syncs the current Connector URL into ChatGPT when browser automation is connected.",
    "2. Run /connector only to retry that browser setup flow after a UI drift or account permission issue.",
    "3. Ask explicitly: use the ai-browser-bridge connector; do not answer from memory.",
    "4. A reply mentioning /mnt/data, upload a zip, or paste tree/find output means ChatGPT is not using this local connector.",
  ].join("\n");
};

/**
 * Format the result of the browser-automated ChatGPT connector setup flow.
 *
 * @param result - Result value.
 * @returns The `formatConnectorSetupResult` result.
 * @example
 * ```ts
 * const result = formatConnectorSetupResult(result);
 * ```
 */
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

// --- commands/files.format.ts ---

/** Print a formatted attachment table to stdout. */
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
      attachment.filename ?? "",
      String(attachment.messageIndex),
    ]),
  ];
  const widths = computeColumnWidths(rows);
  for (const row of rows) {
    console.log(formatTableRow({ row, widths }));
  }
};

/** Compute max column widths for a table row matrix. */
const computeColumnWidths = (rows: string[][]): number[] => {
  return (rows[0] ?? []).map((...args: [string, number]) =>
    maxColumnLength({ rows, column: args[1] }),
  );
};

/** Return the longest cell length in one column. */
const maxColumnLength = (input: { rows: string[][]; column: number }): number => {
  return Math.max(...input.rows.map((row) => (row[input.column] ?? "").length));
};

/** Format one table row with padded cells. */
const formatTableRow = (input: { row: string[]; widths: number[] }): string => {
  return input.row
    .map((...args: [string, number]) =>
      padTableCell({ cell: args[0], column: args[1], widths: input.widths }),
    )
    .join("  ");
};

/** Pad one table cell to its column width. */
const padTableCell = (input: { cell: string; column: number; widths: number[] }): string => {
  return input.cell.padEnd(input.widths[input.column] ?? 0);
};

/** Split slash-command args respecting quotes. */
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

/** Push trailing token when arg splitting finishes. */
const finalizeSplitArgs = (input: { current: string; args: string[] }): string[] => {
  if (input.current) input.args.push(input.current);
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
    if (input.current) input.args.push(input.current);
    return { current: "", quote: input.quote };
  }
  return { current: input.current + input.char, quote: input.quote };
};

// --- commands/files.helpers.ts ---

/** Runtime orchestrator extension exposing the active Playwright page. */
interface RuntimeOrchestrator {
  page?: Page | null;
}

/** Normalized attachment download result. */
/** Lazy-loaded attachment downloader module. */
interface AttachmentDownloaderModule {
  downloadAttachment(
    page: Page,
    conversationId: string,
    id: string,
    opts?: { outDir?: string; repoRoot?: string },
  ): Promise<unknown>;
  downloadAll(
    page: Page,
    conversationId: string,
    opts?: { outDir?: string; repoRoot?: string; ids?: string[] },
  ): Promise<unknown>;
}

/** Return the active Playwright page from command context. */
const currentPage = (ctx: CommandContext): Page | null => {
  const orchestrator = ctx.orchestrator as CommandContext["orchestrator"] & RuntimeOrchestrator;
  return orchestrator.page ?? null;
};

/** Extract the ChatGPT conversation id from the active page URL. */
const conversationIdFromPage = (page: Page): string => {
  return chatGptConversationIdFromUrl(page.url()) ?? "current";
};

/** Whether a value is a non-null object record. */
const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

/** Parse `--out <dir>` from slash-command args. */
const parseOutDir = (args: string[]): string | undefined => {
  const outIndex = args.indexOf("--out");
  if (outIndex === -1) return undefined;
  return args[outIndex + 1];
};

/** Print an error message to stderr in red. */
const printError = (message: string): void => {
  console.error(`${RED}${message}${RESET}`);
};

// --- commands/files.download.helpers.ts ---

interface HandleDownloadInput {
  page: Page;
  conversationId: string;
  parts: string[];
  manifestIds: string[];
  repoRoot: string;
}

/** Download one attachment or all attachments from `/files get`. */
const handleFilesDownload = async (input: HandleDownloadInput): Promise<void> => {
  const outDir = parseOutDir(input.parts.slice(2));
  const downloader = await loadDownloader();
  if (input.parts[1] === "all") {
    return printBulkResults(
      await downloader.downloadAll(input.page, input.conversationId, {
        repoRoot: input.repoRoot,
        ...(outDir ? { outDir } : {}),
      }),
    );
  }
  await downloadOneAttachment({ input, downloader, outDir });
};

/** Download a single attachment by id. */
const downloadOneAttachment = async (input: {
  input: HandleDownloadInput;
  downloader: AttachmentDownloaderModule;
  outDir: string | undefined;
}): Promise<void> => {
  const id = input.input.parts[1];
  if (!id) return printError("Usage: download <attachment-id>");
  if (!input.input.manifestIds.includes(id)) return printError(`No attachment with id "${id}".`);
  const raw = await input.downloader.downloadAttachment(
    input.input.page,
    input.input.conversationId,
    id,
    { repoRoot: input.input.repoRoot, ...(input.outDir ? { outDir: input.outDir } : {}) },
  );
  console.log(normalizeDownloadResult({ value: raw, fallbackId: id }).path);
};

const printBulkResults = (raw: unknown): void => {
  const results = normalizeDownloadAll(raw);
  const succeeded = results.filter((result) => !result.error).length;
  const failed = results.length - succeeded;
  console.log(
    `Downloaded ${succeeded}/${results.length} attachments${failed > 0 ? ` (${failed} failed)` : ""}.`,
  );
  for (const result of results) {
    if (result.error) printError(`${result.id ?? "unknown"}: ${result.error}`);
    else console.log(`${result.id ?? "attachment"} -> ${result.path} (${result.bytes} bytes)`);
  }
};

const loadDownloader = async (): Promise<AttachmentDownloaderModule> => {
  return (await import(DOWNLOADER_MODULE)) as AttachmentDownloaderModule;
};

const normalizeDownloadAll = (value: unknown): DownloadResult[] => {
  if (!Array.isArray(value)) return [];
  return value.map((...args: [unknown, number]) =>
    normalizeDownloadResult({ value: args[0], fallbackId: `attachment-${args[1] + 1}` }),
  );
};

const normalizeDownloadResult = (input: { value: unknown; fallbackId: string }): DownloadResult => {
  if (!isRecord(input.value)) return { id: input.fallbackId, path: String(input.value), bytes: 0 };
  return {
    id: typeof input.value.id === "string" ? input.value.id : input.fallbackId,
    path: typeof input.value.path === "string" ? input.value.path : "",
    bytes: typeof input.value.bytes === "number" ? input.value.bytes : 0,
    error: typeof input.value.error === "string" ? input.value.error : undefined,
  };
};

// --- commands/files.ts ---

/** CLI slash command for listing and downloading ChatGPT attachments. */
const filesCommand: CommandDef = {
  name: "files",
  description: "List or download ChatGPT conversation attachments",
  handler: (...args: [string, CommandContext]) =>
    handleFilesCommand({ args: args[0], ctx: args[1] }),
};

/** Dispatch `/files` list or download subcommands. */
const handleFilesCommand = async (input: { args: string; ctx: CommandContext }): Promise<void> => {
  const context = await loadFilesContext(input);
  const parts = splitArgs(input.args);
  if (parts.length === 0) return printAttachmentTable(context.manifest.attachments);
  await routeFilesDownload({ parts, context });
};

/** Load manifest and page context for `/files`. */
const loadFilesContext = async (input: { args: string; ctx: CommandContext }) => {
  const page = currentPage(input.ctx);
  const conversationId = page ? conversationIdFromPage(page) : "current";
  const manifest = await loadManifest(conversationId);
  return { page, conversationId, manifest, repoRoot: input.ctx.config.repoPath };
};

/** Route `/files get` download requests or print usage errors. */
const routeFilesDownload = async (input: {
  parts: string[];
  context: {
    page: Page | null;
    conversationId: string;
    manifest: Awaited<ReturnType<typeof loadManifest>>;
    repoRoot: string;
  };
}): Promise<void> => {
  if (input.parts[0] !== "get")
    return console.log("Usage: /files [get <id>|get all [--out <dir>]]");
  if (!input.parts[1]) return console.log("Usage: /files get <id> or /files get all [--out <dir>]");
  if (!input.context.page) return printError("Browser not connected. Cannot download attachments.");
  await handleFilesDownload({
    page: input.context.page,
    conversationId: input.context.conversationId,
    parts: input.parts,
    manifestIds: input.context.manifest.attachments.map((item) => item.id),
    repoRoot: input.context.repoRoot,
  });
};

// --- commands/handlers/helpers/sessionStore.ts ---

/** Session-store options scoped to a repo's `.bridge/sessions`. */
const sessionStore = (repoPath: string): SessionStoreOptions => {
  return { baseDir: sessionsDir(repoPath) };
};

// --- commands/handlers/helpers/try-load-session.ts ---

/** Parameters for loading a session without throwing. */
interface TryLoadSessionParams {
  /** Session id to load. */
  sessionId: string;
  /** Session store scoped to the repo. */
  options: SessionStoreOptions;
}

/** Load a session by id, returning null instead of throwing when it is missing. */
const tryLoadSession = async (params: TryLoadSessionParams) => {
  try {
    return await loadSession(params.sessionId, params.options);
  } catch {
    return null;
  }
};

// --- commands/handlers/helpers/resolve-session-id.ts ---

/** Inputs for resolving which session a command targets. */
interface ResolveSessionIdParams {
  /** Raw command arguments. */
  args: string;
  /** Active command context. */
  ctx: CommandContext;
}

/** Resolve session id from explicit arg, current session, or latest. */
const resolveSessionId = async (params: ResolveSessionIdParams): Promise<string | null> => {
  const [requested] = splitArgs(params.args);
  if (requested) return requested;
  if (params.ctx.session?.getId()) return params.ctx.session.getId();
  const latest = await getLatestSession(sessionStore(params.ctx.config.repoPath));
  return latest?.metadata.id ?? null;
};

// --- commands/handlers/helpers/repo-file-path.ts ---

/** Inputs for resolving a user path within the repo. */
interface ResolveRepoFilePathParams {
  /** Repository root directory. */
  repoRoot: string;
  /** User-supplied relative or absolute path. */
  input: string;
}

/** Resolve a user path to a repo-relative path, rejecting escapes outside the repo. */
const resolveRepoFilePath = (params: ResolveRepoFilePathParams): string => {
  if (isAbsolute(params.input)) {
    const rel = relative(resolve(params.repoRoot), resolve(params.input));
    return ensureInsideRepo(rel || ".", params.repoRoot);
  }
  return ensureInsideRepo(params.input, params.repoRoot);
};

/** Throw unless the path has a supported raster image extension. */
const assertImagePath = (path: string): void => {
  const extension = extname(path).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extension)) {
    throw new Error(`Unsupported image type: ${basename(path)}`);
  }
};

// --- commands/handlers/helpers/copy-clipboard.ts ---

/** Copy text to the macOS clipboard via `pbcopy`. */
const copyTextToClipboard = async (text: string): Promise<void> => {
  await new Promise<void>((...args: [() => void, (reason?: unknown) => void]) => {
    runPbcopy({ text, resolve: args[0], reject: args[1] });
  });
};

/** Spawn `pbcopy` and stream text to stdin. */
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

// --- commands/handlers/helpers/capture-screenshots.ts ---

/** Inputs for capturing desktop and mobile URL screenshots. */
interface CaptureUrlScreenshotsParams {
  /** HTTP or HTTPS URL to capture. */
  url: string;
  /** Repository root for storing screenshots. */
  repoPath: string;
}

/** Capture full-page desktop + mobile screenshots of a URL into a timestamped dir. */
const captureUrlScreenshots = async (params: CaptureUrlScreenshotsParams): Promise<string[]> => {
  const parsed = parseCaptureUrl(params.url);
  const dir = await prepareScreenshotDir(params.repoPath);
  return await captureWithPlaywright({ parsed, dir });
};

/** Validate and normalize a screenshot target URL. */
const parseCaptureUrl = (url: string): string => {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are supported.");
  }
  return parsed.toString();
};

/** Create a timestamped screenshot output directory. */
const prepareScreenshotDir = async (repoPath: string): Promise<string> => {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(screenshotsDir(repoPath), stamp);
  await mkdir(dir, { recursive: true });
  return dir;
};

/** Playwright capture inputs. */
interface CaptureWithPlaywrightParams {
  /** Normalized URL string. */
  parsed: string;
  /** Output directory for PNG files. */
  dir: string;
}

/** Launch Playwright and write viewport screenshots. */
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

/** Single viewport capture inputs. */
interface CaptureViewportParams {
  /** Playwright browser instance. */
  browser: Awaited<ReturnType<Awaited<typeof import("playwright")>["chromium"]["launch"]>>;
  /** Viewport name and dimensions. */
  viewport: { name: string; width: number; height: number };
  /** URL to navigate to. */
  parsed: string;
  /** Output directory. */
  dir: string;
}

/** Capture one viewport screenshot and return its file path. */
const captureViewport = async (params: CaptureViewportParams): Promise<string> => {
  const page = await params.browser.newPage({
    viewport: { width: params.viewport.width, height: params.viewport.height },
  });
  await page.goto(params.parsed, { waitUntil: "networkidle", timeout: 45_000 });
  const file = await writeViewportScreenshot({ page, viewport: params.viewport, dir: params.dir });
  await page.close();
  return file;
};

/** Write a full-page screenshot for one viewport. */
const writeViewportScreenshot = async (input: {
  page: Awaited<ReturnType<CaptureViewportParams["browser"]["newPage"]>>;
  viewport: CaptureViewportParams["viewport"];
  dir: string;
}): Promise<string> => {
  const file = join(input.dir, `${input.viewport.name}.png`);
  await input.page.screenshot({ path: file, fullPage: true });
  return file;
};

// --- commands/handlers/helpers/session-export.ts ---

/** Parsed `/export` target session and optional output path. */
interface SessionExportSelection {
  /** Resolved session id, or null when none is available. */
  sessionId: string | null;
  /** Optional absolute output file path. */
  outputPath?: string;
}

/** Inputs for parsing `/export` arguments. */
interface ResolveSessionExportParams {
  /** Raw command arguments. */
  args: string;
  /** Active command context. */
  ctx: CommandContext;
}

/** Parse `/export` args into session id and optional output path. */
const resolveSessionExportArgs = async (
  params: ResolveSessionExportParams,
): Promise<SessionExportSelection> => {
  const parts = splitArgs(params.args);
  if (parts.length === 0) {
    return { sessionId: await resolveSessionId({ args: "", ctx: params.ctx }) };
  }
  return resolveSessionExportFromParts({ parts, ctx: params.ctx });
};

/** Resolve export target from parsed `/export` tokens. */
const resolveSessionExportFromParts = async (input: {
  parts: string[];
  ctx: CommandContext;
}): Promise<SessionExportSelection> => {
  const first = input.parts[0] ?? "";
  const store = sessionStore(input.ctx.config.repoPath);
  const session = await tryLoadSession({ sessionId: first, options: store });
  if (session) {
    return {
      sessionId: session.metadata.id,
      outputPath: input.parts[1] ? resolve(input.parts[1]) : undefined,
    };
  }
  return {
    sessionId: await resolveSessionId({ args: "", ctx: input.ctx }),
    outputPath: resolve(first),
  };
};

/** Default export location for a session when no output path is given. */
const defaultExportPath = (params: { repoPath: string; sessionId: string }): string => {
  return join(exportsDir(params.repoPath), `${params.sessionId}.md`);
};

/** Pick export payload (json/jsonl/markdown) based on file extension. */
const exportContentForPath = (params: { path: string; exported: SessionExport }): string => {
  const extension = extname(params.path).toLowerCase();
  if (extension === ".json") return params.exported.json;
  if (extension === ".jsonl") return params.exported.jsonl;
  return params.exported.transcript;
};

// --- commands/handlers/browser/general.ts ---

/** Start a new ChatGPT conversation. */
const handleNew = async (_args: string, ctx: CommandContext): Promise<void> => {
  await ctx.orchestrator.newConversation();
  console.log("Started new conversation.");
};

/** Stop the active ChatGPT response. */
const handleStop = async (_args: string, ctx: CommandContext): Promise<void> => {
  const stopped = await ctx.orchestrator.stopResponse();
  console.log(stopped ? "Stopped active response." : "No active response to stop.");
};

/** Ask ChatGPT for a concise progress summary. */
const handleCompact = async (_args: string, ctx: CommandContext): Promise<void> => {
  await ctx.sendMessage(
    "Summarize our progress so far in a structured format: what we've done, what's in progress, what's next. Be concise.",
  );
  console.log(
    "Compaction summary requested. Start a new conversation to continue with that summary.",
  );
};

/** Show the local bridge log file path. */
const handleLogs = async (_args: string, ctx: CommandContext): Promise<void> => {
  console.log(`Bridge logs: ${bridgeLogPath(ctx.config.repoPath)}`);
};

/** Show bridge status. */
const handleStatus = async (_args: string, ctx: CommandContext): Promise<void> => {
  console.log(formatBridgeStatus(ctx));
};

/** Show status bar fields. */
const handleStatusline = async (_args: string, ctx: CommandContext): Promise<void> => {
  console.log(formatBridgeStatus(ctx));
};

/** Clear the terminal chat view. */
const handleClear = async (_args: string, ctx: CommandContext): Promise<void> => {
  ctx.clearMessages?.();
  console.log(
    "Cleared terminal chat view. Browser conversation, context estimate, and local session logs are unchanged.",
  );
};

/** Show current git diff via ChatGPT. */
const handleDiff = async (_args: string, ctx: CommandContext): Promise<void> => {
  await ctx.sendMessage("Show me the current git diff for the repository.");
};

/** Shutdown the bridge. */
const handleExit = async (_args: string, ctx: CommandContext): Promise<void> => {
  if (ctx.shutdown) {
    await ctx.shutdown();
    return;
  }
  console.log("Shutting down...");
  process.exit(0);
};

// --- commands/handlers/browser/help.ts ---

/** List all available slash commands. */
const handleHelp = async (_args: string, ctx: CommandContext): Promise<void> => {
  const all = getAllCommands();
  console.log("\nAvailable commands:\n");
  for (const cmd of all) {
    console.log(`  /${cmd.name.padEnd(16)} ${cmd.description}`);
  }
  await printCustomCommands(ctx);
  console.log("");
};

/** Print project/user custom commands when present. */
const printCustomCommands = async (ctx: CommandContext): Promise<void> => {
  const custom = await loadCustomCommands({ repoRoot: ctx.config.repoPath });
  if (custom.length === 0) return;
  console.log("\nCustom commands:\n");
  for (const cmd of custom) {
    console.log(`  /${cmd.name.padEnd(16)} ${cmd.description ?? `${cmd.source} command`}`);
  }
};

/** List project/user custom commands. */
const handleCommands = async (_args: string, ctx: CommandContext): Promise<void> => {
  const custom = await loadCustomCommands({ repoRoot: ctx.config.repoPath });
  if (custom.length === 0) {
    console.log("No custom commands found in .bridge/commands or ~/.ai-browser-bridge/commands.");
    return;
  }
  console.log("\nCustom commands:\n");
  for (const command of custom) {
    console.log(
      `  /${command.name.padEnd(16)} ${command.description ?? `${command.source} command`}`,
    );
  }
  console.log("");
};

// --- commands/handlers/browser/media.ts ---

/** Attach a repo image file to ChatGPT. */
const handleAttachImage = async (args: string, ctx: CommandContext): Promise<void> => {
  const target = args.trim();
  if (!target) {
    console.log("Usage: /attach-image <repo-relative-image-path>");
    return;
  }
  await attachRepoImage({ target, ctx });
};

/** Resolve, validate, and attach one repo image path. */
const attachRepoImage = async (input: { target: string; ctx: CommandContext }): Promise<void> => {
  const imagePath = resolveRepoFilePath({
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

/** Capture desktop/mobile screenshots for a URL. */
const handleScreenshot = async (args: string, ctx: CommandContext): Promise<void> => {
  const url = args.trim();
  if (!url) {
    console.log("Usage: /screenshot <url>");
    return;
  }
  const files = await captureUrlScreenshots({ url, repoPath: ctx.config.repoPath });
  printScreenshotPaths(files);
};

/** Capture UI screenshots and ask ChatGPT to review them. */
const handleUiQa = async (args: string, ctx: CommandContext): Promise<void> => {
  const url = args.trim();
  if (!url) {
    console.log("Usage: /ui-qa <url>");
    return;
  }
  const files = await runUiQaCapture({ url, ctx });
  console.log(`UI QA requested with ${files.length} screenshots.`);
};

/** Capture screenshots, attach them, and send the review prompt. */
const runUiQaCapture = async (input: { url: string; ctx: CommandContext }): Promise<string[]> => {
  const files = await captureUrlScreenshots({
    url: input.url,
    repoPath: input.ctx.config.repoPath,
  });
  if (input.ctx.orchestrator.attachFiles) await input.ctx.orchestrator.attachFiles(files);
  await sendUiQaPrompt({ url: input.url, files, ctx: input.ctx });
  return files;
};

/** Print captured screenshot file paths. */
const printScreenshotPaths = (files: string[]): void => {
  console.log("Screenshots:");
  for (const file of files) console.log(`  ${file}`);
};

/** Inputs for sending a UI QA review prompt. */
interface SendUiQaPromptParams {
  /** Reviewed page URL. */
  url: string;
  /** Screenshot file paths. */
  files: string[];
  /** Active command context. */
  ctx: CommandContext;
}

/** Send UI QA review instructions with screenshot references. */
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

// --- commands/handlers/browser.ts ---

/** Browser and terminal UI slash-command handlers keyed by command name. */
const BROWSER_HANDLERS: Record<string, (args: string, ctx: CommandContext) => Promise<void>> = {
  help: handleHelp,
  new: handleNew,
  stop: handleStop,
  compact: handleCompact,
  commands: handleCommands,
  logs: handleLogs,
  status: handleStatus,
  statusline: handleStatusline,
  clear: handleClear,
  "attach-image": handleAttachImage,
  screenshot: handleScreenshot,
  "ui-qa": handleUiQa,
  diff: handleDiff,
  exit: handleExit,
};

// --- commands/handlers/session/conversations.ts ---

/** List sidebar conversations or navigate when a query is provided. */
const handleConversations = async (args: string, ctx: CommandContext): Promise<void> => {
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

/** Inputs for opening a conversation by id or title fragment. */
interface OpenMatchingConversationParams {
  /** User search query. */
  query: string;
  /** Active command context. */
  ctx: CommandContext;
}

/** Navigate to the first conversation matching the query. */
const openMatchingConversation = async (params: OpenMatchingConversationParams): Promise<void> => {
  const [match] = await params.ctx.orchestrator.searchConversations({
    query: params.query,
    limit: 1,
  });
  if (match) {
    console.log(`Navigating to: ${match.title} (${match.id})`);
    await params.ctx.orchestrator.navigateToConversation(match.url);
    return;
  }
  console.log(`No conversation matching "${params.query}".`);
};

/** Print numbered conversation titles for `/resume`. */
const printConversationList = (conversations: Array<{ id: string; title: string }>): void => {
  console.log("\nChatGPT Conversations:\n");
  conversations.forEach((conversation, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${conversation.title}`);
  });
  console.log("\nUse /resume <number> to continue a conversation.\n");
};

// --- commands/handlers/session/list-sessions.ts ---

/** List local bridge sessions with current-session marker. */
const handleSessions = async (_args: string, ctx: CommandContext): Promise<void> => {
  const sessions = await listSessions(sessionStore(ctx.config.repoPath));
  if (sessions.length === 0) {
    console.log("No local bridge sessions found.");
    return;
  }
  printSessionRows({ sessions, currentId: ctx.session?.getId() });
};

/** Inputs for printing the session table. */
interface PrintSessionRowsParams {
  /** Session metadata rows. */
  sessions: Array<{ id: string; updatedAt: string; model?: string | null; repoPath: string }>;
  /** Currently active session id, if any. */
  currentId?: string;
}

/** Print up to 20 local sessions with a current-session marker. */
const printSessionRows = (params: PrintSessionRowsParams): void => {
  console.log("\nLocal sessions:\n");
  for (const session of params.sessions.slice(0, 20)) {
    const marker = session.id === params.currentId ? "*" : " ";
    console.log(
      `${marker} ${session.id.padEnd(38)} ${session.updatedAt} ${session.model ?? "unknown"} ${session.repoPath}`,
    );
  }
  console.log("\nUse /resume --last or /resume <session-id> to make a session current.\n");
};

// --- commands/handlers/session/resume.ts ---

/** Resume a browser conversation or local bridge session. */
const handleResume = async (args: string, ctx: CommandContext): Promise<void> => {
  const query = args.trim();
  if (!query) {
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

/** Activate the most recently updated local session. */
const resumeLatestSession = async (ctx: CommandContext): Promise<void> => {
  const latest = await getLatestSession(sessionStore(ctx.config.repoPath));
  if (!latest) {
    console.log("No local bridge sessions found.");
    return;
  }
  await ctx.session?.setId(latest.metadata.id);
  console.log(formatSessionSummary(latest.metadata, ctx.session?.getId()));
};

/** Inputs for resuming a local session by id fragment. */
interface ResumeLocalSessionParams {
  /** Session id or fragment. */
  query: string;
  /** Active command context. */
  ctx: CommandContext;
}

/** Try to resume a local session; returns true when matched. */
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

/** Inputs for resuming a browser sidebar conversation. */
interface ResumeBrowserConversationParams {
  /** Number, id, or title fragment. */
  query: string;
  /** Active command context. */
  ctx: CommandContext;
}

/** Navigate to a numbered or named browser conversation. */
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

/** Match a browser conversation by number, id, or title fragment. */
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

// --- commands/handlers/session/transcript.ts ---

/** Print the local session transcript. */
const handleTranscript = async (args: string, ctx: CommandContext): Promise<void> => {
  const sessionId = await resolveSessionId({ args, ctx });
  if (!sessionId) {
    console.log("No local session selected. Use /sessions first.");
    return;
  }
  const exported = await exportSession(sessionId, sessionStore(ctx.config.repoPath));
  console.log(trimOutput(exported.transcript || "(empty transcript)", 40_000));
};

/** Copy the local session transcript to the clipboard. */
const handleCopy = async (args: string, ctx: CommandContext): Promise<void> => {
  const sessionId = await resolveSessionId({ args, ctx });
  if (!sessionId) {
    console.log("No local session selected. Use /sessions first.");
    return;
  }
  const exported = await exportSession(sessionId, sessionStore(ctx.config.repoPath));
  await copyTextToClipboard(exported.transcript);
  console.log(`Copied transcript for ${sessionId} to clipboard.`);
};

/** Export the local session transcript to a file. */
const handleExport = async (args: string, ctx: CommandContext): Promise<void> => {
  const selection = await resolveSessionExportArgs({ args, ctx });
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

/** Inputs for writing a session export file. */
interface WriteSessionExportParams {
  /** Resolved session id. */
  sessionId: string;
  /** Optional absolute output file path. */
  outputPath?: string;
  /** Active command context. */
  ctx: CommandContext;
}

/** Write exported session content to disk. */
const writeSessionExport = async (params: WriteSessionExportParams): Promise<void> => {
  const store = sessionStore(params.ctx.config.repoPath);
  const exported = await exportSession(params.sessionId, store);
  const targetPath =
    params.outputPath ??
    defaultExportPath({ repoPath: params.ctx.config.repoPath, sessionId: params.sessionId });
  await persistSessionExport({ targetPath, exported, sessionId: params.sessionId });
};

/** Create parent dirs and write exported session content. */
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

// --- commands/handlers/session/checkpoints.ts ---

/** List file checkpoints for the current repo. */
const handleCheckpoints = async (_args: string, ctx: CommandContext): Promise<void> => {
  const checkpoints = await listCheckpoints({ repoRoot: ctx.config.repoPath });
  if (checkpoints.length === 0) {
    console.log("No checkpoints found.");
    return;
  }
  printCheckpointRows(checkpoints);
};

/** Print up to 20 checkpoint rows. */
const printCheckpointRows = (
  checkpoints: Array<{ id: string; phase: string; fileCount: number; label?: string }>,
): void => {
  console.log("\nCheckpoints:\n");
  for (const checkpoint of checkpoints.slice(0, 20)) {
    console.log(
      `  ${checkpoint.id.padEnd(38)} ${checkpoint.phase.padEnd(6)} ${checkpoint.fileCount} files ${checkpoint.label ?? ""}`,
    );
  }
  console.log("\nUse /restore <checkpoint-id> or /rewind --files <checkpoint-id>.\n");
};

/** Restore files from a checkpoint, optionally scoped to paths. */
const handleRestore = async (args: string, ctx: CommandContext): Promise<void> => {
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

/** Rewind the last prompt and/or restore checkpoint files. */
const handleRewind = async (args: string, ctx: CommandContext): Promise<void> => {
  const parts = splitArgs(args);
  if (parts[0] === "--files" || parts[0] === "--both") {
    await rewindWithCheckpoint({ mode: parts[0], parts, ctx });
    return;
  }
  const replacement = args.trim() || undefined;
  await ctx.orchestrator.rewindLastPrompt(replacement);
  console.log(replacement ? "Rewound with replacement prompt." : "Rewound the last prompt.");
};

/** Inputs for checkpoint-aware rewind. */
interface RewindWithCheckpointParams {
  /** `--files` or `--both` mode flag. */
  mode: string;
  /** Parsed command tokens. */
  parts: string[];
  /** Active command context. */
  ctx: CommandContext;
}

/** Restore checkpoint files and optionally rewind the last prompt. */
const rewindWithCheckpoint = async (params: RewindWithCheckpointParams): Promise<void> => {
  const checkpointId = params.parts[1];
  if (!checkpointId) {
    console.log(`Usage: /rewind ${params.mode} <checkpoint-id> [replacement prompt]`);
    return;
  }
  await restoreAndMaybeRewind(params, checkpointId);
};

/** Restore checkpoint files and optionally rewind with a replacement prompt. */
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

/** Rewind the last prompt after checkpoint restore in `--both` mode. */
const rewindPromptAfterRestore = async (params: RewindWithCheckpointParams): Promise<void> => {
  const replacement = params.parts.slice(2).join(" ").trim() || undefined;
  await params.ctx.orchestrator.rewindLastPrompt(replacement);
  console.log(
    replacement
      ? "Restored files and rewound with replacement prompt."
      : "Restored files and rewound the last prompt.",
  );
};

// --- commands/handlers/session.ts ---

/** Session-related slash-command handlers keyed by command name. */
const SESSION_HANDLERS: Record<string, (args: string, ctx: CommandContext) => Promise<void>> = {
  conversations: handleConversations,
  resume: handleResume,
  sessions: handleSessions,
  transcript: handleTranscript,
  copy: handleCopy,
  export: handleExport,
  checkpoints: handleCheckpoints,
  restore: handleRestore,
  rewind: handleRewind,
};

// --- commands/handlers/mcp/connector.ts ---

/** True when the configured provider has no MCP connector UI (browser-only web chat/generation). */
const providerLacksMcpConnector = (ctx: CommandContext): boolean => {
  return !getBrowserProvider(ctx.config.provider).supportsMcpConnector;
};

/** Show MCP connector setup and exposed tools. */
const handleMcp = async (_args: string, ctx: CommandContext): Promise<void> => {
  if (providerLacksMcpConnector(ctx)) {
    printNoMcpDiagnostics(ctx);
    return;
  }
  console.log(formatMcpDiagnostics(ctx));
};

/** Print MCP-limitation diagnostics for providers without a connector UI. */
const printNoMcpDiagnostics = (ctx: CommandContext): void => {
  const label = getProviderDisplayName(normalizeProvider(ctx.config.provider));
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

/** Open ChatGPT MCP connector setup in the browser. */
const handleConnector = async (_args: string, ctx: CommandContext): Promise<void> => {
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

/** Print connector limitation message for providers without a connector UI. */
const printNoConnectorWarning = (ctx: CommandContext): void => {
  const label = getProviderDisplayName(normalizeProvider(ctx.config.provider));
  console.log(
    `${label} web has no custom MCP connector UI. Use @file mentions for read-only repo context, or run with --provider chatgpt, claude, or grok for full MCP tools.`,
  );
};

/** Print guidance when no public connector URL exists. */
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

/** Run browser connector setup automation when available. */
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
  const result = await params.ctx.orchestrator.openConnectorSetup({
    connectorUrl: params.connector,
  });
  console.log(formatConnectorSetupResult(result));
};

// --- commands/handlers/mcp/permissions.ts ---

/** Show or switch MCP permission mode. */
const handlePermissions = async (args: string, ctx: CommandContext): Promise<void> => {
  const next = args.trim();
  if (!next) {
    printPermissionModes(ctx);
    return;
  }
  await setPermissionMode({ next, ctx });
};

/** Print current permission mode and available values. */
const printPermissionModes = (ctx: CommandContext): void => {
  console.log(
    `Permission mode: ${ctx.permission?.getMode() ?? ctx.config.permissionMode ?? "auto"}`,
  );
  console.log(`Available: ${PERMISSION_MODES.join(", ")}`);
};

/** Apply a new permission mode when valid. */
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

// --- commands/handlers/mcp/task.ts ---

/** Send a project-agent task with MCP tool instructions. */
const handleTask = async (args: string, ctx: CommandContext): Promise<void> => {
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
  await ctx.sendMessage(buildProjectTaskPromptWithInstructions(task, ctx, instructions.promptText));
};

/** Print `/task` limitation message for providers without MCP tools. */
const printNoMcpTaskWarning = (ctx: CommandContext): void => {
  const label = getProviderDisplayName(normalizeProvider(ctx.config.provider));
  console.log(
    `${label} web does not support MCP connectors. /task needs live repo tools — use --provider chatgpt, claude, or grok, or send a normal prompt with @file mentions.`,
  );
};

/** Ask ChatGPT to review local repository changes. */
const handleReview = async (args: string, ctx: CommandContext): Promise<void> => {
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

// --- commands/handlers/mcp.ts ---

/** MCP-related slash-command handlers keyed by command name. */
const MCP_HANDLERS: Record<string, (args: string, ctx: CommandContext) => Promise<void>> = {
  task: handleTask,
  permissions: handlePermissions,
  mcp: handleMcp,
  connector: handleConnector,
  review: handleReview,
};

// --- commands/handlers/model.ts ---

/** Show or switch the ChatGPT model. */
const handleModel = async (args: string, ctx: CommandContext): Promise<void> => {
  const query = args.trim();
  if (query) {
    await switchModel({ query, ctx });
    return;
  }
  await showCurrentModel(ctx);
};

/** Switch model and print context estimate update. */
const switchModel = async (params: { query: string; ctx: CommandContext }): Promise<void> => {
  const model = await params.ctx.orchestrator.switchModel(params.query);
  params.ctx.counter.setModel(model);
  const profile = findModelProfile(model);
  console.log(
    `Model switched to ${model}. Context estimate now uses ${profile.contextWindow.toLocaleString()} tokens.`,
  );
};

/** Print current model details and available browser models. */
const showCurrentModel = async (ctx: CommandContext): Promise<void> => {
  const current = await ctx.orchestrator.detectModel();
  ctx.counter.setModel(current);
  printModelProfile(current);
  await printAvailableModels(ctx);
};

/** Print browser models or static known profiles. */
const printAvailableModels = async (ctx: CommandContext): Promise<void> => {
  const available = await ctx.orchestrator.listModels();
  if (available.length > 0) {
    printBrowserModels(available);
    return;
  }
  printKnownProfiles();
};

/** Print context profile for a model name. */
const printModelProfile = (model: string): void => {
  const profile = findModelProfile(model);
  console.log(`\nCurrent model: ${model}`);
  console.log(`Context window: ${profile.contextWindow.toLocaleString()} tokens`);
  if (profile.maxOutputTokens) {
    console.log(`Max output:     ${profile.maxOutputTokens.toLocaleString()} tokens`);
  }
  console.log(`Source:         ${profile.sourceUrl}`);
};

/** Print browser model picker entries. */
const printBrowserModels = (models: Array<{ label: string; selected?: boolean }>): void => {
  console.log("\nBrowser models:");
  for (const model of models) {
    console.log(`  ${model.selected ? "*" : " "} ${model.label}`);
  }
  console.log("\nUse /model <name> to switch.");
};

/** Print static known context profiles. */
const printKnownProfiles = (): void => {
  console.log("\nKnown context profiles:");
  for (const model of listModelProfiles()) {
    console.log(`  ${model.label.padEnd(24)} ${model.contextWindow.toLocaleString()} ctx`);
  }
};

/** Show context window usage for the active model. */
const handleContext = async (_args: string, ctx: CommandContext): Promise<void> => {
  console.log(`Context estimate for ${ctx.counter.modelLabel}: ${ctx.counter.summary}`);
};

/** Model-related slash-command handlers keyed by command name. */
const MODEL_HANDLERS: Record<string, (args: string, ctx: CommandContext) => Promise<void>> = {
  model: handleModel,
  context: handleContext,
};

// --- commands/registry.helpers.ts ---

/** Run a built-in handler and report failures without throwing. */
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

/** Resolve and run a user-defined custom command. */
const executeCustomCommand = async (input: {
  parsed: { name: string; args: string };
  ctx: CommandContext;
}): Promise<boolean> => {
  const custom = await findCustomCommand({ name: input.parsed.name, ctx: input.ctx });
  if (!custom) return false;
  await input.ctx.sendMessage(renderCustomCommandPrompt(custom, input.parsed.args));
  return true;
};

/** Split a raw `/name args...` string into its name and argument remainder. */
const parseCommandInput = (input: string): { name: string; args: string } | null => {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const { name, args } = splitCommandNameAndArgs(trimmed);
  if (!name) return null;
  return { name, args };
};

/** Extract command name and args from a trimmed slash input string. */
const splitCommandNameAndArgs = (trimmed: string): { name: string; args: string } => {
  const spaceIdx = trimmed.indexOf(" ");
  const name = spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx);
  const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1);
  return { name, args };
};

/** Look up a project/user custom command by name. */
const findCustomCommand = async (input: { name: string; ctx: CommandContext }) => {
  const custom = await loadCustomCommands({ repoRoot: input.ctx.config.repoPath });
  return custom.find((command) => command.name === input.name);
};

// --- commands/builtins.ts ---

/** Handler lookup table keyed by slash-command name. */
type CommandHandlerMap = Record<string, CommandDef["handler"]>;

/** Inputs for composing command definitions from metadata and handlers. */
interface ComposeCommandsInput {
  /** Command metadata entries. */
  meta: CommandMeta[];
  /** Handler map keyed by command name. */
  handlers: CommandHandlerMap;
}

/**
 * Compose {@link CommandDef} entries from metadata arrays and handler maps.
 * Keeps `builtins.ts` thin while `commands.config.ts` stays declaration-free.
 */
const composeCommands = (input: ComposeCommandsInput): CommandDef[] => {
  return input.meta.flatMap((entry) => {
    const handler = input.handlers[entry.name];
    if (!handler) return [];
    return [{ name: entry.name, description: entry.description, aliases: entry.aliases, handler }];
  });
};

/** Built-in slash commands registered at startup via `registry.ts`. */
const BUILTIN_COMMANDS: CommandDef[] = [
  filesCommand,
  ...composeCommands({ meta: SESSION_COMMANDS, handlers: SESSION_HANDLERS }),
  ...composeCommands({ meta: MODEL_COMMANDS, handlers: MODEL_HANDLERS }),
  ...composeCommands({ meta: MCP_COMMANDS, handlers: MCP_HANDLERS }),
  ...composeCommands({ meta: BROWSER_COMMANDS, handlers: BROWSER_HANDLERS }),
];

// --- commands/registry.ts ---

/**
 * Slash-command dispatch: the registry Map plus lookup/execution. The actual
 * command catalog lives in `builtins.ts` and `commands.config.ts` (imported
 * below) and custom user
 * commands are resolved on demand from markdown files. Importing this module
 * registers all built-ins as a side effect, so consumers only need to import
 * {@link executeCommand} / {@link getAllCommands} to get a working command set.
 */

const commands = new Map<string, CommandDef>();
const canonicalNames = new Set<string>();

/**
 * Register a command under its name and any aliases.
 *
 * @param cmd - Cmd value.
 * @returns Completes when `registerCommand` finishes.
 * @example
 * ```ts
 * registerCommand(cmd);
 * ```
 */
export const registerCommand = (cmd: CommandDef): void => {
  commands.set(cmd.name, cmd);
  canonicalNames.add(cmd.name);
  for (const alias of cmd.aliases ?? []) {
    commands.set(alias, cmd);
  }
};

/**
 * Get all registered, non-hidden commands (for autocomplete and `/help`).
 *
 * @returns The `getAllCommands` result.
 * @example
 * ```ts
 * const result = getAllCommands();
 * ```
 */
export const getAllCommands = (): CommandDef[] => {
  return [...canonicalNames]
    .map((name) => commands.get(name))
    .filter((cmd): cmd is CommandDef => !!cmd && !cmd.hidden);
};

/**
 * Parse input as a registered command, or null if it is not a known command string.
 *
 * @param input - Input values for the operation.
 * @returns The `parseCommand` result.
 * @example
 * ```ts
 * const result = parseCommand(input);
 * ```
 */
export const parseCommand = (input: string): { name: string; args: string } | null => {
  const parsed = parseCommandInput(input);
  if (!parsed || !commands.has(parsed.name)) return null;
  return parsed;
};

/**
 * Execute a command, returning true if the input was handled.
 *
 * Falls back to project/user custom commands (markdown templates) when the name
 * is not a built-in, and reports handler errors without throwing.
 *
 * @param input - Input values for the operation.
 * @param ctx - Context values for the operation.
 * @returns The `executeCommand` result.
 * @example
 * ```ts
 * const result = await executeCommand(input, ctx);
 * ```
 */
export const executeCommand = async (input: string, ctx: CommandContext): Promise<boolean> => {
  const parsed = parseCommandInput(input);
  if (!parsed) return false;
  const cmd = commands.get(parsed.name);
  if (!cmd) return executeCustomCommand({ parsed, ctx });
  return executeBuiltinCommand({ parsed, cmd, ctx });
};

/**
 * Filter commands whose name starts with the partial text after the `/`.
 *
 * @param partial - Partial value.
 * @returns The `matchCommands` result.
 * @example
 * ```ts
 * const result = matchCommands(partial);
 * ```
 */
export const matchCommands = (partial: string): CommandDef[] => {
  const q = partial.toLowerCase();
  return getAllCommands().filter((cmd) => cmd.name.toLowerCase().startsWith(q));
};

for (const command of BUILTIN_COMMANDS) {
  registerCommand(command);
}

// --- headless/shared.ts ---

/** Fatal error helper: write to stderr and exit non-zero. */
const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

/** Redirect console.log to stderr so stdout stays machine-readable. */
const redirectConsoleToStderr = (): void => {
  console.log = (...args: unknown[]) => console.error(...args);
  console.info = (...args: unknown[]) => console.error(...args);
  console.debug = (...args: unknown[]) => console.error(...args);
};

/**
 * Convert a CLI `--timeout <seconds>` string to milliseconds for the engine.
 * Returns undefined for absent/empty/NaN/non-positive input so the browser
 * layer falls back to its default wait.
 *
 * @param seconds - Seconds value.
 * @returns The `timeoutMsFromSeconds` result.
 * @example
 * ```ts
 * const result = timeoutMsFromSeconds(seconds);
 * ```
 */
export const timeoutMsFromSeconds = (seconds: string | undefined): number | undefined => {
  if (!seconds) return undefined;
  const parsed = Number(seconds);
  if (Number.isNaN(parsed) || parsed <= 0) return undefined;
  return Math.round(parsed * 1000);
};

/**
 * Stop the in-flight ChatGPT turn, tear the engine down, then exit. Used by the
 * headless signal handlers so a Ctrl-C / kill clicks "Stop generating" before
 * dropping the process — otherwise ChatGPT keeps generating server-side in the
 * warm tab and burns Plus quota on a reply nobody captures.
 *
 * @param engine - Engine value.
 * @param code - Code value.
 * @param exit - Exit value.
 * @returns Completes when `abortAndExit` finishes.
 * @example
 * ```ts
 * await abortAndExit(engine, code, exit);
 * ```
 */
export const abortAndExit = async (
  engine: BridgeEngine,
  code: number,
  exit: (code: number) => never,
): Promise<void> => {
  await engine
    .getOrchestrator()
    .stopResponse()
    .catch(() => {});
  await engine.shutdown({ closeBrowser: false }).catch(() => {});
  exit(code);
};

/** Print stored bridge sessions (newest first) as JSON. */
const runSessionsCmd = async (): Promise<void> => {
  const sessions = await listSessions();
  process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
  process.exit(0);
};

/** Print Chrome/debug-port status without opening a browser. */
const runBrowserStatusCmd = async (options: BrowserStatusOptions = {}): Promise<void> => {
  const status = await readBrowserStatus();
  if (options.json) process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  else process.stdout.write(`${formatBrowserDebugStatus(status)}\n`);
  process.exit(0);
};

/** Resolve a Chrome profile root option to an absolute path. */
const resolveCacheProfileRoot = (options: CacheCmdOptions): string => {
  return options.profile ? resolve(options.profile) : bridgeChromeProfileRoot();
};

/** Print generated Chrome cache inventory. */
const runCacheListCmd = async (options: CacheCmdOptions): Promise<void> => {
  const inventory = await inventoryChromeCache({
    profileRoot: resolveCacheProfileRoot(options),
  });
  if (options.json) process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
  else process.stdout.write(`${formatCacheInventory(inventory)}\n`);
  process.exit(0);
};

/** Prune allowlisted generated Chrome cache, defaulting to dry-run unless confirmed. */
const runCachePruneCmd = async (options: CacheCmdOptions): Promise<void> => {
  const dryRun = options.dryRun ?? !options.yes;
  if (!dryRun) await assertChromeClosedForCachePrune();
  const result = await pruneChromeCache({
    profileRoot: resolveCacheProfileRoot(options),
    dryRun,
    confirm: options.yes,
  });
  if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`${formatCachePruneResult(result)}\n`);
  process.exit(0);
};

/** Refuse destructive cache cleanup while Chrome may be using the profile. */
const assertChromeClosedForCachePrune = async (): Promise<void> => {
  const status = await readBrowserStatus();
  if (!status.chromeRunning) return;
  fail("Quit Chrome before pruning generated cache from the shared bridge profile.");
};

/** Kill whatever process is listening on the Chrome debug port (macOS `lsof`). */
const killDebugPort = (port: number): Promise<boolean> => {
  return new Promise((resolveKill) => {
    execFile("lsof", ["-ti", `tcp:${port}`], (...args: [Error | null, string]) => {
      resolveKill(killPidsFromStdout(args[1]));
    });
  });
};

/** Parse lsof stdout and kill each pid (best-effort). */
const killPidsFromStdout = (stdout: string): boolean => {
  const pids = stdout.trim().split(/\s+/).filter(Boolean);
  if (pids.length === 0) return false;
  for (const pid of pids) killPidBestEffort(pid);
  return true;
};

/** Kill one pid, ignoring errors when the process is already gone. */
const killPidBestEffort = (pid: string): void => {
  try {
    process.kill(Number(pid));
  } catch {
    // process already gone
  }
};

// --- headless/ask.output.helpers.ts ---

/** Ensure the browser is connected and signed in, or exit with guidance. */
const assertSignedIn = async (
  engine: Awaited<ReturnType<typeof startEngine>>,
  browserProvider: ReturnType<typeof getBrowserProvider>,
  provider: ReturnType<typeof normalizeProvider>,
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

/** Inputs for {@link writeAskOutput}. */
interface WriteAskOutputContext {
  /** Engine whose session/model/counter back the JSON payload. */
  engine: Awaited<ReturnType<typeof startEngine>>;
  /** Captured assistant reply, or null when the turn produced nothing. */
  reply: Awaited<ReturnType<Awaited<ReturnType<typeof startEngine>>["ask"]>>;
  /** Real orchestrator failure captured during the turn, if any. */
  orchestratorError: string | null;
  /** Parsed ask options (controls JSON vs plain output). */
  options: AskOptions;
  /** Normalized provider id used in the login hint. */
  provider: ReturnType<typeof normalizeProvider>;
  /** Human-readable provider name used in the login hint. */
  displayName: string;
}

/**
 * Write the ask reply as plain text or JSON, or exit when no reply was captured.
 *
 * On a null reply, prefer the real orchestrator error (e.g. a send timeout) over
 * the generic login hint, which previously masked every failure as a sign-in
 * problem even when ChatGPT had replied in the browser.
 */
const writeAskOutput = (ctx: WriteAskOutputContext): void => {
  if (!ctx.reply) {
    fail(
      ctx.orchestratorError ??
        `No reply captured — ${ctx.displayName} may not be logged in, or the page UI changed. Try \`bridge chrome start --provider ${ctx.provider}\`.`,
    );
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

// --- headless/ask.helpers.ts ---

/** Inputs for starting the ask engine. */
interface StartAskEngineInput {
  /** CLI ask options. */
  options: AskOptions;
  /** Normalized provider id. */
  provider: ReturnType<typeof normalizeProvider>;
  /** Whether the provider supports MCP connector tooling. */
  supportsMcpConnector: boolean;
}

/** Run the full headless ask flow and exit. Fans out for --batch or a comma --provider list. */
const runAskFlow = async (input: { prompt: string; options: AskOptions }): Promise<void> => {
  if (input.options.batch) return runBatchAsk(input.options);
  if (!input.prompt.trim()) {
    return fail('Provide a prompt (e.g. `bridge ask "hi"`) or a task file via --batch.');
  }
  const providers = resolveProviderListOrFail(input.options.provider);
  if (providers.length > 1) {
    return runFanoutAsk({ prompt: input.prompt, providers, options: input.options });
  }
  redirectConsoleToStderr();
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

/** Parse a comma-separated --provider list, or exit cleanly on an unknown provider. */
const resolveProviderListOrFail = (spec: string | undefined): BridgeProviderId[] => {
  try {
    return parseProviderList(spec);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
};

/**
 * Fan one prompt out across several providers as a batch (one task per provider, one tab
 * each) and print the ordered result, exiting per {@link fanoutBatchFailed}.
 */
const runFanoutAsk = async (input: {
  prompt: string;
  providers: BridgeProviderId[];
  options: AskOptions;
}): Promise<void> => {
  const tasks: FanoutTask[] = input.providers.map((provider) => ({
    prompt: input.prompt,
    provider,
  }));
  await runBatchAndReport({
    tasks,
    provider: input.providers[0] ?? DEFAULT_PROVIDER,
    options: input.options,
  });
};

/** Run an explicit `--batch` task file/JSON as a fan-out and print the ordered result. */
const runBatchAsk = async (options: AskOptions): Promise<void> => {
  const tasks = await loadBatchTasks(options.batch ?? "");
  await runBatchAndReport({ tasks, provider: normalizeProvider(options.provider), options });
};

/** Read the `--batch` source: inline JSON array, `@file`, or a bare file path. */
const readBatchSource = async (spec: string): Promise<string> => {
  const trimmed = spec.trim();
  if (trimmed.startsWith("[")) return trimmed;
  const path = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  const absolute = isAbsolute(path) ? path : resolve(process.cwd(), path);
  return readFile(absolute, "utf8");
};

/** Parse and validate the `--batch` source into a task list, or exit cleanly on bad input. */
const loadBatchTasks = async (spec: string): Promise<readonly FanoutTask[]> => {
  if (!spec.trim()) return fail("--batch needs a task file, @file, or inline JSON array.");
  const raw = await readBatchSource(spec).catch((err: unknown) =>
    fail(`--batch could not read ${spec}: ${err instanceof Error ? err.message : String(err)}`),
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return fail(`--batch is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    return Schema.decodeUnknownSync(FanoutBatchSchema)(parsed);
  } catch (err) {
    return fail(
      `--batch does not match the task schema (need a non-empty array of {prompt, provider?, conversation?, label?, isolate?}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
};

/** Start one warm engine, run a task list through the fan-out batch core, print, and exit. */
const runBatchAndReport = async (input: {
  tasks: readonly FanoutTask[];
  provider: BridgeProviderId;
  options: AskOptions;
}): Promise<void> => {
  redirectConsoleToStderr();
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
    const result = await runFanoutBatch({
      browser: engine.browser,
      config: engine.config,
      tasks: input.tasks,
      manifestRoot: attachmentManifestsDir(),
      options: batchOptionsFromAsk(input.options),
    });
    writeBatchOutput(result, input.options);
    await engine.shutdown({ closeBrowser: false }).catch(() => {});
    process.exit(fanoutBatchFailed(result, Boolean(input.options.strict)) ? 1 : 0);
  } catch (err) {
    await engine.shutdown({ closeBrowser: false }).catch(() => {});
    return fail(err instanceof Error ? err.message : String(err));
  }
};

/** Parse a positive integer CLI option, or undefined when unset/invalid. */
const positiveIntFromOption = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

/** Parse a non-negative integer CLI option, or undefined when unset/invalid. */
const nonNegativeIntFromOption = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

/** Map ask CLI flags to fan-out batch options, dropping the ones left unset. */
const batchOptionsFromAsk = (options: AskOptions): FanoutBatchOptions => {
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

/** Print a fan-out result as one JSON object (--json) or a labelled block per task. */
const writeBatchOutput = (result: FanoutBatchResult, options: AskOptions): void => {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  result.results.forEach((row, index) => {
    const status = row.ok ? "ok" : "error";
    const heading = row.label ?? `task ${result.offset + index + 1}`;
    const target = row.target
      ? ` ${row.target.provider}${row.target.id ? ` ${row.target.id}` : ""}`
      : "";
    const truncated = row.truncated ? `, truncated from ${row.replyChars}` : "";
    const body = row.ok ? (row.reply ?? "") : (row.error ?? "");
    process.stdout.write(
      `=== ${heading} (${status}, ${row.elapsedMs}ms${target}${truncated}) ===\n${body}\n\n`,
    );
  });
  if (result.nextOffset !== null) {
    const remaining = result.total - result.offset - result.results.length;
    process.stdout.write(
      `… ${remaining} more task(s). Re-run with --offset ${result.nextOffset}.\n`,
    );
  }
};

/** Run one gateway `ask` batch on a warm engine, then shut it down keeping the browser warm. */
const runBatchForServe = async (
  tasks: FanoutTask[],
  batchOptions: FanoutBatchOptions,
  base: AskOptions,
): Promise<FanoutBatchResult> => {
  const provider = normalizeProvider(base.provider);
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
    return await runFanoutBatch({
      browser: engine.browser,
      config: engine.config,
      tasks,
      manifestRoot: attachmentManifestsDir(),
      options: batchOptions,
    });
  } finally {
    await engine.shutdown({ closeBrowser: false }).catch(() => {});
  }
};

/**
 * Serve the outbound MCP `ask` gateway over stdio so other agents can drive one or more
 * web chats as a native tool. Each `ask` call runs a fan-out batch on a warm engine via
 * {@link runBatchForServe}, so the shared browser is reused across calls and one slow
 * Conversation never blocks the rest.
 *
 * Console output is redirected to stderr first: stdout is the JSON-RPC channel, and any
 * engine/browser log written there would corrupt the protocol stream.
 *
 * @param options - Options that configure the operation.
 * @returns Completes when `runServe` finishes.
 * @example
 * ```ts
 * await runServe(options);
 * ```
 */
export const runServe = async (options: ServeOptions): Promise<void> => {
  redirectConsoleToStderr();
  const base: AskOptions = { repo: options.repo, port: options.port, timeout: options.timeout };
  const deps: AskGatewayDeps = {
    runBatch: (tasks, opts) => runBatchForServe(tasks, opts, base),
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
        await engine.shutdown({ closeBrowser: false }).catch(() => {});
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
        await engine.shutdown({ closeBrowser: false }).catch(() => {});
      }
    },
  };
  await serveAskGatewayStdio(deps);
};

interface ConversationSearchOutcome {
  ok: boolean;
  results?: ConversationSearchResult[];
  error?: string;
  elapsedMs: number;
}

/** Search conversations across providers and capture per-provider failures. */
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

/** Search one provider's conversations through the browser-backed orchestrator. */
const searchOneProvider = async (
  provider: BridgeProviderId,
  query: string,
  options: AskOptions,
  searchOptions: { limit?: number },
): Promise<ConversationSearchResult[]> => {
  const browserProvider = getBrowserProvider(provider);
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
    await engine.shutdown({ closeBrowser: false }).catch(() => {});
  }
};

/**
 * Subscribe to orchestrator error events for a headless ask so a null reply can
 * report the real failure cause instead of the generic "not logged in" hint.
 *
 * `sendPrompt` emits `{ type: "error" }` and resolves to null on failure, so the
 * headless path would otherwise lose the actual reason (e.g. a send timeout).
 * Read `lastError()` after the ask turn and before shutdown to capture it.
 */
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

/** Start engine, register signals, and verify sign-in. */
const prepareAskRun = async (options: AskOptions) => {
  const providers = resolveAskProviders(options);
  const engine = await startAskEngine({
    options,
    provider: providers.provider,
    supportsMcpConnector: providers.browserProvider.supportsMcpConnector,
  });
  registerAskSignalHandlers(engine);
  await assertSignedIn(engine, providers.browserProvider, providers.provider);
  return { engine, ...providers };
};

/** Resolve normalized provider and browser provider for ask runs. */
const resolveAskProviders = (options: AskOptions) => {
  const provider = normalizeProvider(options.provider);
  return { provider, browserProvider: getBrowserProvider(provider) };
};

/** Shut down engine, write output, and exit. */
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

/** Start the engine for a headless ask run. */
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

/** Register SIGINT/SIGTERM handlers that abort the in-flight turn. */
const registerAskSignalHandlers = (engine: Awaited<ReturnType<typeof startEngine>>): void => {
  process.once("SIGINT", () => void abortAndExit(engine, 130, process.exit));
  process.once("SIGTERM", () => void abortAndExit(engine, 143, process.exit));
};

/** Parse the --images count into a positive integer, or undefined when unset or invalid. */
const imageCountFromOption = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

/** Parse the --debug-port flag into a positive port number, or undefined when unset or invalid. */
const debugPortFromOption = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

/** Resolve the --profile flag into an absolute Chrome user-data-dir, or undefined when unset. */
const profileRootFromOption = (value: string | undefined): string | undefined => {
  return value ? resolve(value) : undefined;
};

/** Apply preflight options and send the ask prompt. */
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

/** Attach repo-relative images before the prompt when --attach is set. */
const attachAskFiles = async (input: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  options: AskOptions;
}): Promise<void> => {
  const paths = input.options.attach;
  if (!paths?.length) return;
  const repoRoot = resolve(input.options.repo ?? process.cwd());
  const resolved = paths.map((target) => {
    const rel = resolveRepoFilePath({ repoRoot, input: target });
    assertImagePath(rel);
    return resolve(repoRoot, rel);
  });
  await input.engine.getOrchestrator().attachFiles(resolved);
};

/** Resolve a conversation flag to a ChatGPT thread URL. */
const conversationUrlFromOption = (value: string): string => {
  return chatGptConversationUrlFromIdOrUrl(value);
};

/** Navigate to a conversation only when the active tab is on a different thread. */
const navigateToConversationIfNeeded = async (input: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  conversation?: string;
  page: Page;
}): Promise<void> => {
  if (!input.conversation) return;
  const targetUrl = conversationUrlFromOption(input.conversation);
  if (isSameChatGptConversation(input.page.url(), targetUrl)) return;
  await input.engine
    .getOrchestrator()
    .navigateToConversation(targetUrl)
    .catch(() => {});
};

/** Apply --fresh, --conversation, and --model preflight options before asking. */
const applyAskPreflight = async (input: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  options: AskOptions;
}): Promise<void> => {
  if (input.options.fresh)
    await input.engine
      .getOrchestrator()
      .newConversation()
      .catch(() => {});
  else if (input.options.conversation) {
    await input.engine
      .getOrchestrator()
      .navigateToConversation(conversationUrlFromOption(input.options.conversation))
      .catch(() => {});
  }
  if (input.options.model)
    await input.engine
      .getOrchestrator()
      .switchModel(input.options.model)
      .catch(() => {});
};

// --- headless/download.helpers.ts ---

/** Reject Gemini until attachment download is supported there. */
const assertDownloadProviderSupported = (options: DownloadCmdOptions): void => {
  if (normalizeProvider(options.provider) === "gemini") {
    fail("Attachment download is not supported for Gemini web yet. Use ChatGPT for /download.");
  }
};

/** Download attachments with optional output dir and id filter. */
const downloadConversationAttachments = async (input: {
  page: Page;
  conversationId: string;
  options: DownloadCmdOptions;
  manifestRoot: string;
}): Promise<DownloadResult[]> => {
  const ids = parseAttachmentIds(input.options.id);
  return downloadAll(input.page, input.conversationId, {
    repoRoot: resolve(input.options.repo ?? process.cwd()),
    manifestRoot: input.manifestRoot,
    ...(input.options.out ? { outDir: input.options.out } : {}),
    ...(ids ? { ids } : {}),
  });
};

/** Write download results as JSON or human-readable lines. */
const writeDownloadOutput = (results: DownloadResult[], json?: boolean): void => {
  if (json) {
    process.stdout.write(`${JSON.stringify(results)}\n`);
    return;
  }
  for (const result of results) {
    const line = `${formatDownloadLine(result)}\n`;
    if (result.error) process.stderr.write(line);
    else process.stdout.write(line);
  }
};

/**
 * Flatten repeated `--id` flags into a clean id list.
 * Returns `undefined` when nothing remains so callers can omit `ids`.
 *
 * @param values - Values value.
 * @returns The `parseAttachmentIds` result.
 * @example
 * ```ts
 * const result = parseAttachmentIds(values);
 * ```
 */
export const parseAttachmentIds = (values: string[] | undefined): string[] | undefined => {
  if (!values) return undefined;
  const ids = values
    .flatMap((value) => value.split(/[\s,]+/))
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : undefined;
};

/**
 * Render one download result as a human-readable line for the terminal.
 *
 * @param result - Result value.
 * @returns The `formatDownloadLine` result.
 * @example
 * ```ts
 * const result = formatDownloadLine(result);
 * ```
 */
export const formatDownloadLine = (result: DownloadResult): string => {
  const label = result.id ?? "attachment";
  if (result.error) return `${label}: ${result.error}`;
  return `${label} -> ${result.path} (${result.bytes} bytes)`;
};

// --- headless/download.ts ---

/** Download a conversation's attachments to disk without the TUI. */
const runDownloadCmd = async (options: DownloadCmdOptions): Promise<void> => {
  assertDownloadProviderSupported(options);
  redirectConsoleToStderr();
  const results = await runDownloadFlow(options);
  writeDownloadOutput(results, options.json);
  process.exit(0);
};

/** Start engine, extract messages, and download attachments. */
const runDownloadFlow = async (options: DownloadCmdOptions): Promise<DownloadResult[]> => {
  const context = await prepareDownloadContext(options);
  const results = await downloadAfterExtract(context);
  await context.engine.shutdown({ closeBrowser: false });
  return results;
};

/** Start engine and resolve page plus conversation id. */
const prepareDownloadContext = async (options: DownloadCmdOptions) => {
  const engine = await startDownloadEngine(options);
  const page = requireBrowserPage(engine);
  return {
    engine,
    page,
    conversationId: options.conversation ?? conversationIdFromPage(page),
    options,
  };
};

/** Download attachments with optional output dir and id filter. */
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
  return downloadConversationAttachments({ ...input, manifestRoot });
};

/** Start the engine for a headless download run. */
const startDownloadEngine = async (options: DownloadCmdOptions) => {
  return startEngine({
    repoPath: options.repo ? resolve(options.repo) : undefined,
    provider: normalizeProvider(options.provider),
    mcpPort: options.port ? Number(options.port) : undefined,
    withBrowser: true,
    withTools: false,
    persist: false,
    debugPort: debugPortFromOption(options.debugPort),
    profileRoot: profileRootFromOption(options.profile),
  });
};

/** Require a connected browser or exit with guidance. */
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

// --- headless/workspace.ts ---

/** Reject non-ChatGPT providers: Projects, chat moves, and Scheduled tasks are ChatGPT-only. */
const assertChatgptWorkspace = (options: CommonCliOptions): void => {
  if (normalizeProvider(options.provider) !== "chatgpt") {
    fail(
      "Projects, chat moves, and Scheduled tasks are ChatGPT-only. Omit --provider or pass --provider chatgpt.",
    );
  }
};

/** Start a ChatGPT engine attached to the warm browser and resolve its page. */
const startWorkspaceSession = async (options: CommonCliOptions & BrowserTargetOptions) => {
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

/** `bridge project list` — print the ChatGPT Projects, one per line (or JSON). */
const runProjectListCmd = async (options: ProjectCmdOptions): Promise<void> => {
  assertChatgptWorkspace(options);
  redirectConsoleToStderr();
  const { engine, page } = await startWorkspaceSession(options);
  const projects = await listProjects(page);
  await engine.shutdown({ closeBrowser: false });
  if (options.json) process.stdout.write(`${JSON.stringify(projects)}\n`);
  else if (projects.length === 0) process.stdout.write("No projects.\n");
  else for (const project of projects) process.stdout.write(`${project.name}\n`);
  process.exit(0);
};

/** `bridge project create <name>` — create a ChatGPT Project. */
const runProjectCreateCmd = async (name: string, options: ProjectCmdOptions): Promise<void> => {
  assertChatgptWorkspace(options);
  if (!name.trim()) fail("Usage: bridge project create <name>");
  redirectConsoleToStderr();
  const { engine, page } = await startWorkspaceSession(options);
  const project = await createProject(page, name);
  await engine.shutdown({ closeBrowser: false });
  if (options.json) process.stdout.write(`${JSON.stringify(project)}\n`);
  else process.stdout.write(`Created project: ${project.name}\n`);
  process.exit(0);
};

/** `bridge project rename <name> --to <newName>` — rename a ChatGPT Project. */
const runProjectRenameCmd = async (name: string, options: ProjectCmdOptions): Promise<void> => {
  assertChatgptWorkspace(options);
  const to = options.to?.trim();
  if (!name.trim() || !to) return fail("Usage: bridge project rename <name> --to <newName>");
  redirectConsoleToStderr();
  const { engine, page } = await startWorkspaceSession(options);
  const outcome = await renameProject(page, { project: name, name: to });
  await engine.shutdown({ closeBrowser: false });
  if (options.json) process.stdout.write(`${JSON.stringify(outcome)}\n`);
  else if (outcome.renamed)
    process.stdout.write(`Renamed "${outcome.project}" -> ${outcome.renamedTo}\n`);
  else process.stdout.write(`Skipped "${outcome.project}": ${outcome.reason}\n`);
  process.exit(outcome.renamed ? 0 : 1);
};

/** `bridge project delete <name> --yes` — delete a ChatGPT Project (permanently deletes its chats). */
const runProjectDeleteCmd = async (name: string, options: ProjectCmdOptions): Promise<void> => {
  assertChatgptWorkspace(options);
  if (!name.trim()) return fail("Usage: bridge project delete <name> --yes");
  if (!options.yes) {
    return fail(
      `Refusing to delete project "${name}" without --yes; this permanently deletes its chats.`,
    );
  }
  redirectConsoleToStderr();
  const { engine, page } = await startWorkspaceSession(options);
  const outcome = await deleteProject(page, name);
  await engine.shutdown({ closeBrowser: false });
  if (options.json) process.stdout.write(`${JSON.stringify(outcome)}\n`);
  else if (outcome.deleted) process.stdout.write(`Deleted project "${outcome.project}"\n`);
  else process.stdout.write(`Skipped "${outcome.project}": ${outcome.reason}\n`);
  process.exit(outcome.deleted ? 0 : 1);
};

/** `bridge chat list [--orphans]` — list sidebar (project-less) conversations. */
const runChatListCmd = async (options: ChatCmdOptions): Promise<void> => {
  assertChatgptWorkspace(options);
  redirectConsoleToStderr();
  const { engine } = await startWorkspaceSession(options);
  const chats = await engine.getOrchestrator().listConversations();
  await engine.shutdown({ closeBrowser: false });
  if (options.json) process.stdout.write(`${JSON.stringify(chats)}\n`);
  else if (chats.length === 0) process.stdout.write("No conversations.\n");
  else for (const chat of chats) process.stdout.write(`${chat.id}\t${chat.title}\n`);
  process.exit(0);
};

/** `bridge chat search <query>` — search ChatGPT conversation history. */
const runChatSearchCmd = async (query: string, options: ChatCmdOptions): Promise<void> => {
  assertChatgptWorkspace(options);
  if (!query.trim()) fail("Usage: bridge chat search <query>");
  redirectConsoleToStderr();
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

/** Parse an optional positive integer CLI limit. */
const limitFromOption = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

/** Open the best search hit when requested. */
const maybeOpenSearchMatch = async (input: {
  engine: Awaited<ReturnType<typeof startWorkspaceSession>>["engine"];
  results: ConversationSearchResult[];
  open: boolean;
}): Promise<void> => {
  const [best] = input.results;
  if (!input.open || !best) return;
  await input.engine.getOrchestrator().navigateToConversation(best.url);
};

/** Print search results as JSON or stable tab-separated rows. */
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
  for (const result of results) {
    process.stdout.write(`${result.id}\t${result.title}\t${result.source}\t${result.score}\n`);
  }
};

/**
 * Resolve which conversations a `chat move`/`chat archive` call targets: the `--id` list when
 * given (batch, one browser session), else the single joined positional title/id. Trims each and
 * drops blanks.
 *
 * @param chat - Positional chat title or id (joined words); may be empty in batch mode.
 * @param options - Chat command options carrying the optional `--id` list.
 * @returns The resolved, de-blanked target list (empty when nothing was supplied).
 * @example
 * ```ts
 * const targets = resolveChatTargets("", { id: ["a", "b"] });
 * ```
 */
export const resolveChatTargets = (chat: string, options: ChatCmdOptions): string[] => {
  const ids = (options.id ?? []).map((value) => value.trim()).filter(Boolean);
  if (ids.length > 0) return ids;
  const single = chat.trim();
  return single ? [single] : [];
};

/** Print `chat move` outcomes as a JSON array or one human-readable line per conversation. */
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

/** `bridge chat move <idOrTitle...> --project <name>` — move one or more conversations. */
const runChatMoveCmd = async (chat: string, options: ChatCmdOptions): Promise<void> => {
  assertChatgptWorkspace(options);
  const project = options.project?.trim();
  const targets = resolveChatTargets(chat, options);
  if (targets.length === 0 || !project) {
    return fail("Usage: bridge chat move <idOrTitle> --project <name>  (batch: --id <id...>)");
  }
  redirectConsoleToStderr();
  const { engine, page } = await startWorkspaceSession(options);
  const outcomes: MoveChatOutcome[] = [];
  for (const target of targets) {
    outcomes.push(await moveChatToProject(page, { chat: target, project }));
  }
  await engine.shutdown({ closeBrowser: false });
  writeMoveOutcomes(outcomes, options);
  process.exit(outcomes.every((outcome) => outcome.moved) ? 0 : 1);
};

/** Print `chat archive` outcomes as a JSON array or one human-readable line per conversation. */
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

/** `bridge chat archive <idOrTitle...>` — archive one or more conversations (reversible). */
const runChatArchiveCmd = async (chat: string, options: ChatCmdOptions): Promise<void> => {
  assertChatgptWorkspace(options);
  const targets = resolveChatTargets(chat, options);
  if (targets.length === 0) {
    return fail("Usage: bridge chat archive <idOrTitle>  (batch: --id <id...>)");
  }
  redirectConsoleToStderr();
  const { engine, page } = await startWorkspaceSession(options);
  const outcomes: ArchiveChatOutcome[] = [];
  for (const target of targets) {
    outcomes.push(await archiveChat(page, target));
  }
  await engine.shutdown({ closeBrowser: false });
  writeArchiveOutcomes(outcomes, options);
  process.exit(outcomes.every((outcome) => outcome.archived) ? 0 : 1);
};

/** `bridge task list` — list ChatGPT Scheduled tasks. */
const runTaskListCmd = async (options: TaskCmdOptions): Promise<void> => {
  assertChatgptWorkspace(options);
  redirectConsoleToStderr();
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

/** `bridge task create <prompt> [--every|--at]` — schedule a task via natural language. */
const runTaskCreateCmd = async (prompt: string, options: TaskCmdOptions): Promise<void> => {
  assertChatgptWorkspace(options);
  if (!prompt.trim()) fail("Usage: bridge task create <prompt> [--every <spec> | --at <spec>]");
  redirectConsoleToStderr();
  const { engine } = await startWorkspaceSession(options);
  const content = buildTaskPrompt(prompt, options);
  const reply = await engine.ask({ content });
  await engine.shutdown({ closeBrowser: false });
  if (options.json)
    process.stdout.write(`${JSON.stringify({ content, reply: reply?.content ?? null })}\n`);
  else process.stdout.write(`${reply?.content ?? "(no reply captured)"}\n`);
  process.exit(0);
};

/**
 * Compose the natural-language instruction ChatGPT turns into a Scheduled task.
 *
 * @param prompt - Prompt value.
 * @param options - Options that configure the operation.
 * @returns The `buildTaskPrompt` result.
 * @example
 * ```ts
 * const result = buildTaskPrompt(prompt, options);
 * ```
 */
export const buildTaskPrompt = (prompt: string, options: TaskCmdOptions): string => {
  const cadence = options.every ? `every ${options.every}` : options.at ? `at ${options.at}` : "";
  const when = cadence ? ` Schedule it to run ${cadence}.` : "";
  return `Set up a ChatGPT scheduled task: ${prompt.trim()}.${when}`;
};

// --- headless/chrome-start.ts ---

/**
 * Open the shared bridge Chrome profile with the bridge debug port.
 * The browser is left running (warm) for subsequent `bridge ask` calls.
 */
const runChromeStartCmd = async (options: ChromeStartOptions = {}): Promise<void> => {
  const browser = await launchChromeBrowser(options);
  writeChromeStartInstructions(getBrowserProvider(normalizeProvider(options.provider)).displayName);
  process.exit(0);
};

/** Launch the shared bridge Chrome profile with the debug port enabled. */
const launchChromeBrowser = async (options: ChromeStartOptions): Promise<BrowserManager> => {
  const provider = normalizeProvider(options.provider);
  const browser = new BrowserManager(options.repo ? resolve(options.repo) : undefined, provider, {
    prepareRepoState: false,
    debugPort: debugPortFromOption(options.debugPort),
    profileRoot: profileRootFromOption(options.profile),
  });
  await browser.launch();
  return browser;
};

/** Print Chrome startup instructions to stderr. */
const writeChromeStartInstructions = (displayName: string): void => {
  process.stderr.write(
    `Chrome is open for ${displayName} with the bridge debug port.
This uses the shared bridge Chrome profile, so sign in once in this window and every repo can reuse it.
Leave this Chrome window open; \`bridge ask\` will reconnect to it.
`,
  );
};

// --- headless/stop.ts ---

/** Close the warm Chrome instance holding the debug port. */
const runStopCmd = async (): Promise<void> => {
  const killed = await killDebugPort(BRIDGE_DEBUG_PORT);
  process.stderr.write(
    killed ? "Closed the bridge browser.\n" : "No bridge browser was running.\n",
  );
  process.exit(0);
};

// --- run-tui.ts ---

/** Launch the interactive Ink TUI on top of a shared engine. */
const runTui = async (opts: CommonCliOptions & { browser?: boolean }): Promise<void> => {
  if (!process.stdout.isTTY) {
    process.stderr.write(
      "bridge: the interactive TUI needs a TTY. Use `bridge ask <prompt>` for non-interactive or piped use.\n",
    );
    process.exit(1);
  }
  const provider = normalizeProvider(opts.provider);
  const label = getProviderDisplayName(provider);
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

/** Wire engine events into the Ink app and handle shutdown signals. */
const renderTui = async (engine: Awaited<ReturnType<typeof startEngine>>): Promise<void> => {
  const messages: Message[] = [];
  attachOrchestratorListener({ engine, messages });
  const shutdown = buildShutdownHandler(engine);
  registerShutdownSignals(shutdown);
  const app = renderBridgeApp({ engine, messages, shutdown });
  await app.waitUntilExit();
};

/** Mirror orchestrator message events into the TUI message list. */
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

/** Build a shutdown handler that aborts, tears down, and exits. */
const buildShutdownHandler = (engine: Awaited<ReturnType<typeof startEngine>>) => {
  return async (code = 0): Promise<void> => {
    await engine
      .getOrchestrator()
      .stopResponse()
      .catch(() => {});
    await engine.shutdown({ closeBrowser: false });
    process.exit(code);
  };
};

/** Register SIGINT/SIGTERM handlers for graceful TUI shutdown. */
const registerShutdownSignals = (shutdown: (code?: number) => Promise<void>): void => {
  process.once("SIGINT", () => void shutdown(130));
  process.once("SIGTERM", () => void shutdown(143));
};

/** Render the Ink BridgeApp with engine wiring. */
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

/** Terminal CLI runner: interactive TUI and headless subcommands. */
export class CliRunner {
  /**
   * Launch the interactive Ink TUI (default `bridge` action).
   *
   * @param opts - Opts value.
   * @returns Completes when `runDefault` finishes.
   * @example
   * ```ts
   * await cliRunner.runDefault(opts);
   * ```
   */
  async runDefault(opts: CommonCliOptions & { browser?: boolean }): Promise<void> {
    await runTui(opts);
  }

  /**
   * Send one prompt and print the reply (non-interactive `bridge ask`).
   *
   * @param prompt - Prompt text for the method.
   * @param options - Options that configure the method.
   * @returns Completes when `runAsk` finishes.
   * @example
   * ```ts
   * await cliRunner.runAsk(prompt, options);
   * ```
   */
  async runAsk(prompt: string, options: AskOptions): Promise<void> {
    await runAskFlow({ prompt, options: options ?? {} });
  }

  /**
   * Close the warm bridge browser.
   *
   * @returns Completes when `runStop` finishes.
   * @example
   * ```ts
   * await cliRunner.runStop();
   * ```
   */
  async runStop(): Promise<void> {
    await runStopCmd();
  }

  /**
   * List stored bridge sessions as JSON.
   *
   * @returns Completes when `runSessions` finishes.
   * @example
   * ```ts
   * await cliRunner.runSessions();
   * ```
   */
  async runSessions(): Promise<void> {
    await runSessionsCmd();
  }
}

// --- module re-exports for TUI, tests, register-cli ---

/**
 * Send one prompt and print the reply, leaving the browser warm.
 *
 * @param prompt - Prompt value.
 * @param options - Options that configure the operation.
 * @returns Completes when `runAsk` finishes.
 * @example
 * ```ts
 * await runAsk(prompt, options);
 * ```
 */
export const runAsk = async (prompt: string, options: AskOptions): Promise<void> => {
  const runner = new CliRunner();
  await runner.runAsk(prompt, options);
};

/**
 * Download a conversation's attachments to disk without the TUI.
 *
 * @param options - Options that configure the operation.
 * @returns Completes when `runDownload` finishes.
 * @example
 * ```ts
 * await runDownload(options);
 * ```
 */
export const runDownload = async (options: DownloadCmdOptions): Promise<void> => {
  await runDownloadCmd(options);
};

// --- headless/chatgpt.ts ---

/** One-line human summary of a ChatGPT render state. */
const formatRenderStateLine = (state: ChatGptRenderState): string => {
  const parts = [
    state.streaming ? "streaming" : "idle",
    `images ${state.images.loaded}/${state.images.total}`,
  ];
  if (state.images.pending > 0) parts.push(`${state.images.pending} pending`);
  if (state.expectedImageMarkers > 0) parts.push(`${state.expectedImageMarkers} expected`);
  if (state.misfireSuspected) parts.push("misfire?");
  if (state.limitHit) parts.push(`limit: ${state.limitNotice ?? "hit"}`);
  return parts.join(" | ");
};

/**
 * `bridge chatgpt inspect` — print the current ChatGPT render state (streaming, generated-image
 * progress, misfire/limit signals). With `--all-tabs`, report every ChatGPT tab in the browser.
 *
 * @param options - Options that configure the operation.
 * @returns Completes when the render state is printed.
 * @example
 * ```ts
 * await runChatgptInspect(options);
 * ```
 */
export const runChatgptInspect = async (options: ChatgptCmdOptions): Promise<void> => {
  redirectConsoleToStderr();
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

// --- headless/flow.ts ---

/** Start a Flow engine attached to the warm browser and resolve its page. */
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

/** Default (git-ignored) output directory for downloaded Flow clips. */
const defaultFlowOutDir = (): string => resolve("downloads", "flow");

/** Resolve the single target clip id for a clip verb, or exit with usage. */
const requireClipId = (options: FlowCmdOptions, verb: string): string => {
  const id = options.id?.[0];
  if (!id) return fail(`Usage: bridge flow ${verb} --id <clipId>`);
  return id;
};

/**
 * `bridge flow clips` — list the rendered clips in the current Flow project.
 *
 * @param options - Options that configure the operation.
 * @returns Completes when the clip list is printed.
 * @example
 * ```ts
 * await runFlowClips(options);
 * ```
 */
export const runFlowClips = async (options: FlowCmdOptions): Promise<void> => {
  redirectConsoleToStderr();
  const { engine, page } = await startFlowSession(options);
  const clips = await listClips(page);
  await engine.shutdown({ closeBrowser: false });
  if (options.json) process.stdout.write(`${JSON.stringify(clips)}\n`);
  else if (clips.length === 0) process.stdout.write("No clips in the current Flow project.\n");
  else for (const clip of clips) process.stdout.write(`${clip.id}\t${clip.url}\n`);
  process.exit(0);
};

/**
 * `bridge flow projects` — list the Flow projects in the sidebar.
 *
 * @param options - Options that configure the operation.
 * @returns Completes when the project list is printed.
 * @example
 * ```ts
 * await runFlowProjects(options);
 * ```
 */
export const runFlowProjects = async (options: FlowCmdOptions): Promise<void> => {
  redirectConsoleToStderr();
  const { engine, page } = await startFlowSession(options);
  const projects = await listFlowProjects(page);
  await engine.shutdown({ closeBrowser: false });
  if (options.json) process.stdout.write(`${JSON.stringify(projects)}\n`);
  else if (projects.length === 0) process.stdout.write("No Flow projects.\n");
  else for (const project of projects) process.stdout.write(`${project.id}\t${project.title}\n`);
  process.exit(0);
};

/**
 * `bridge flow download` — download the mp4s of all clips, or the `--id` subset.
 *
 * @param options - Options that configure the operation.
 * @returns Completes when every requested clip has been fetched.
 * @example
 * ```ts
 * await runFlowDownload(options);
 * ```
 */
export const runFlowDownload = async (options: FlowCmdOptions): Promise<void> => {
  redirectConsoleToStderr();
  const { engine, page } = await startFlowSession(options);
  const clips = await listClips(page);
  const targets = options.id && options.id.length > 0 ? options.id : clips.map((clip) => clip.id);
  const outDir = options.out ? resolve(options.out) : defaultFlowOutDir();
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
    for (const result of results)
      process.stdout.write(
        result.ok ? `${result.id}\t${result.file}\n` : `${result.id}\tERROR ${result.error}\n`,
      );
  process.exit(results.every((result) => result.ok) ? 0 : 1);
};

/**
 * `bridge flow generate --start <img> --prompt <text>` — generate a Veo clip from a Start
 * keyframe + shot prompt (image-to-video), then download its mp4 to `--out`.
 *
 * @param options - Options that configure the operation.
 * @returns Completes when the clip renders and its mp4 is written.
 * @example
 * ```ts
 * await runFlowGenerate(options);
 * ```
 */
export const runFlowGenerate = async (options: FlowCmdOptions): Promise<void> => {
  redirectConsoleToStderr();
  const startFramePath = options.start ? resolve(options.start) : "";
  const prompt = options.prompt?.trim() ?? "";
  if (!startFramePath || !prompt) {
    fail("Usage: bridge flow generate --start <imagePath> --prompt <text> [--out <dir>]");
  }
  const outDir = options.out ? resolve(options.out) : defaultFlowOutDir();
  const { engine, page } = await startFlowSession(options);
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
    await engine.shutdown({ closeBrowser: false }).catch(() => {});
    return fail(err instanceof Error ? err.message : String(err));
  }
};

/**
 * `bridge flow delete --id <clipId> --yes` — move a clip to Flow's (recoverable) Trash.
 *
 * @param options - Options that configure the operation.
 * @returns Completes when the clip is trashed.
 * @example
 * ```ts
 * await runFlowDelete(options);
 * ```
 */
export const runFlowDelete = async (options: FlowCmdOptions): Promise<void> => {
  const id = requireClipId(options, "delete");
  if (!options.yes) {
    fail(
      "Refusing to delete without --yes. `bridge flow delete --id <clipId> --yes` moves the clip to Flow Trash (recoverable).",
    );
  }
  redirectConsoleToStderr();
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

/**
 * `bridge flow rename --id <clipId> --name <text>` — rename a clip.
 *
 * @param options - Options that configure the operation.
 * @returns Completes when the clip is renamed.
 * @example
 * ```ts
 * await runFlowRename(options);
 * ```
 */
export const runFlowRename = async (options: FlowCmdOptions): Promise<void> => {
  const id = requireClipId(options, "rename");
  const name = options.name?.trim();
  if (!name) return fail("Usage: bridge flow rename --id <clipId> --name <text>");
  redirectConsoleToStderr();
  const { engine, page } = await startFlowSession(options);
  await renameClip(page, id, name);
  await engine.shutdown({ closeBrowser: false });
  process.stdout.write(
    options.json ? `${JSON.stringify({ id, name })}\n` : `Renamed clip ${id} to "${name}".\n`,
  );
  process.exit(0);
};

/**
 * `bridge flow extend --id <clipId>` — add a clip to a scene (Flow's extend flow).
 *
 * @param options - Options that configure the operation.
 * @returns Completes when the clip is added to the scene.
 * @example
 * ```ts
 * await runFlowExtend(options);
 * ```
 */
export const runFlowExtend = async (options: FlowCmdOptions): Promise<void> => {
  const id = requireClipId(options, "extend");
  redirectConsoleToStderr();
  const { engine, page } = await startFlowSession(options);
  await addClipToScene(page, id);
  await engine.shutdown({ closeBrowser: false });
  process.stdout.write(
    options.json ? `${JSON.stringify({ id, addedTo: "scene" })}\n` : `Added clip ${id} to scene.\n`,
  );
  process.exit(0);
};

/**
 * `bridge flow reuse --id <clipId>` — add a clip back to the prompt as input.
 *
 * @param options - Options that configure the operation.
 * @returns Completes when the clip is added to the prompt.
 * @example
 * ```ts
 * await runFlowReuse(options);
 * ```
 */
export const runFlowReuse = async (options: FlowCmdOptions): Promise<void> => {
  const id = requireClipId(options, "reuse");
  redirectConsoleToStderr();
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

/**
 * `bridge flow project-rename --name <text>` — rename the current Flow project.
 *
 * @param options - Options that configure the operation.
 * @returns Completes when the project is renamed.
 * @example
 * ```ts
 * await runFlowProjectRename(options);
 * ```
 */
export const runFlowProjectRename = async (options: FlowCmdOptions): Promise<void> => {
  const name = options.name?.trim();
  if (!name) return fail("Usage: bridge flow project-rename --name <text>");
  redirectConsoleToStderr();
  const { engine, page } = await startFlowSession(options);
  await renameFlowProject(page, name);
  await engine.shutdown({ closeBrowser: false });
  process.stdout.write(
    options.json ? `${JSON.stringify({ project: name })}\n` : `Renamed project to "${name}".\n`,
  );
  process.exit(0);
};

/**
 * `bridge flow project-delete --yes` — permanently delete the current Flow project.
 *
 * @param options - Options that configure the operation.
 * @returns Completes when the project is deleted.
 * @example
 * ```ts
 * await runFlowProjectDelete(options);
 * ```
 */
export const runFlowProjectDelete = async (options: FlowCmdOptions): Promise<void> => {
  if (!options.yes) {
    fail(
      "Refusing to delete a project without --yes. `bridge flow project-delete --yes` permanently deletes the current project.",
    );
  }
  redirectConsoleToStderr();
  const { engine, page } = await startFlowSession(options);
  await deleteFlowProject(page);
  await engine.shutdown({ closeBrowser: false });
  process.stdout.write(
    options.json ? `${JSON.stringify({ deleted: true })}\n` : "Deleted the current Flow project.\n",
  );
  process.exit(0);
};

/**
 * `bridge flow ingredients` — list the reference images attached to the current prompt.
 *
 * @param options - Options that configure the operation.
 * @returns Completes when the ingredient list is printed.
 * @example
 * ```ts
 * await runFlowIngredients(options);
 * ```
 */
export const runFlowIngredients = async (options: FlowCmdOptions): Promise<void> => {
  redirectConsoleToStderr();
  const { engine, page } = await startFlowSession(options);
  const ingredients = await listIngredients(page);
  await engine.shutdown({ closeBrowser: false });
  if (options.json) process.stdout.write(`${JSON.stringify(ingredients)}\n`);
  else if (ingredients.length === 0)
    process.stdout.write("No ingredients attached to the prompt.\n");
  else for (const item of ingredients) process.stdout.write(`${item.id}\t${item.url}\n`);
  process.exit(0);
};

/**
 * `bridge flow ingredient-remove --id <mediaId>` — detach one prompt ingredient.
 *
 * @param options - Options that configure the operation.
 * @returns Completes when the ingredient is removed.
 * @example
 * ```ts
 * await runFlowIngredientRemove(options);
 * ```
 */
export const runFlowIngredientRemove = async (options: FlowCmdOptions): Promise<void> => {
  const id = options.id?.[0];
  if (!id) return fail("Usage: bridge flow ingredient-remove --id <mediaId>");
  redirectConsoleToStderr();
  const { engine, page } = await startFlowSession(options);
  await removeIngredient(page, id);
  await engine.shutdown({ closeBrowser: false });
  process.stdout.write(
    options.json ? `${JSON.stringify({ id, removed: true })}\n` : `Removed ingredient ${id}.\n`,
  );
  process.exit(0);
};

/**
 * `bridge flow ingredient-clear` — detach every ingredient from the current prompt.
 *
 * @param options - Options that configure the operation.
 * @returns Completes when all ingredients are removed.
 * @example
 * ```ts
 * await runFlowIngredientClear(options);
 * ```
 */
export const runFlowIngredientClear = async (options: FlowCmdOptions): Promise<void> => {
  redirectConsoleToStderr();
  const { engine, page } = await startFlowSession(options);
  const removed = await clearIngredients(page);
  await engine.shutdown({ closeBrowser: false });
  process.stdout.write(
    options.json ? `${JSON.stringify({ removed })}\n` : `Removed ${removed} ingredient(s).\n`,
  );
  process.exit(0);
};

/**
 * `bridge project list` — list ChatGPT Projects (ChatGPT only).
 *
 * @param options - Options that configure the operation.
 * @returns Completes when `runProjectList` finishes.
 * @example
 * ```ts
 * await runProjectList(options);
 * ```
 */
export const runProjectList = async (options: ProjectCmdOptions): Promise<void> => {
  await runProjectListCmd(options);
};

/**
 * `bridge project create <name>` — create a ChatGPT Project (ChatGPT only).
 *
 * @param name - Name value.
 * @param options - Options that configure the operation.
 * @returns Completes when `runProjectCreate` finishes.
 * @example
 * ```ts
 * await runProjectCreate(name, options);
 * ```
 */
export const runProjectCreate = async (name: string, options: ProjectCmdOptions): Promise<void> => {
  await runProjectCreateCmd(name, options);
};

/**
 * `bridge project rename <name> --to <newName>` — rename a ChatGPT Project.
 *
 * @param name - Existing project name.
 * @param options - Options that configure the operation.
 * @returns Completes when `runProjectRename` finishes.
 * @example
 * ```ts
 * await runProjectRename(name, options);
 * ```
 */
export const runProjectRename = async (name: string, options: ProjectCmdOptions): Promise<void> => {
  await runProjectRenameCmd(name, options);
};

/**
 * `bridge project delete <name> --yes` — delete a ChatGPT Project (permanently deletes its chats).
 *
 * @param name - Project name to delete.
 * @param options - Options that configure the operation.
 * @returns Completes when `runProjectDelete` finishes.
 * @example
 * ```ts
 * await runProjectDelete(name, options);
 * ```
 */
export const runProjectDelete = async (name: string, options: ProjectCmdOptions): Promise<void> => {
  await runProjectDeleteCmd(name, options);
};

/**
 * `bridge chat list` — list sidebar (project-less) conversations (ChatGPT only).
 *
 * @param options - Options that configure the operation.
 * @returns Completes when `runChatList` finishes.
 * @example
 * ```ts
 * await runChatList(options);
 * ```
 */
export const runChatList = async (options: ChatCmdOptions): Promise<void> => {
  await runChatListCmd(options);
};

/**
 * `bridge chat search` — search ChatGPT conversation history.
 *
 * @param query - Query value.
 * @param options - Options that configure the operation.
 * @returns Completes when `runChatSearch` finishes.
 * @example
 * ```ts
 * await runChatSearch(query, options);
 * ```
 */
export const runChatSearch = async (query: string, options: ChatCmdOptions): Promise<void> => {
  await runChatSearchCmd(query, options);
};

/**
 * `bridge chat move <idOrTitle> --project <name>` — move a conversation into a Project.
 *
 * @param chat - Chat value.
 * @param options - Options that configure the operation.
 * @returns Completes when `runChatMove` finishes.
 * @example
 * ```ts
 * await runChatMove(chat, options);
 * ```
 */
export const runChatMove = async (chat: string, options: ChatCmdOptions): Promise<void> => {
  await runChatMoveCmd(chat, options);
};

/**
 * `bridge chat archive <idOrTitle...>` — archive one or more conversations (reversible).
 *
 * @param chat - Chat value.
 * @param options - Options that configure the operation.
 * @returns Completes when `runChatArchive` finishes.
 * @example
 * ```ts
 * await runChatArchive(chat, options);
 * ```
 */
export const runChatArchive = async (chat: string, options: ChatCmdOptions): Promise<void> => {
  await runChatArchiveCmd(chat, options);
};

/**
 * `bridge task list` — list ChatGPT Scheduled tasks (ChatGPT only).
 *
 * @param options - Options that configure the operation.
 * @returns Completes when `runTaskList` finishes.
 * @example
 * ```ts
 * await runTaskList(options);
 * ```
 */
export const runTaskList = async (options: TaskCmdOptions): Promise<void> => {
  await runTaskListCmd(options);
};

/**
 * `bridge task create <prompt> [--every|--at]` — schedule a task via natural language.
 *
 * @param prompt - Prompt value.
 * @param options - Options that configure the operation.
 * @returns Completes when `runTaskCreate` finishes.
 * @example
 * ```ts
 * await runTaskCreate(prompt, options);
 * ```
 */
export const runTaskCreate = async (prompt: string, options: TaskCmdOptions): Promise<void> => {
  await runTaskCreateCmd(prompt, options);
};

/**
 * Open the shared bridge Chrome profile with the bridge debug port.
 *
 * @param options - Options that configure the operation.
 * @returns Completes when `runChromeStart` finishes.
 * @example
 * ```ts
 * await runChromeStart(options);
 * ```
 */
export const runChromeStart = async (options: ChromeStartOptions = {}): Promise<void> => {
  await runChromeStartCmd(options);
};

/**
 * Show Chrome/debug-port status.
 *
 * @param options - Options that configure the operation.
 * @returns Completes when `runBrowserStatus` finishes.
 * @example
 * ```ts
 * await runBrowserStatus(options);
 * ```
 */
export const runBrowserStatus = async (options: BrowserStatusOptions = {}): Promise<void> => {
  await runBrowserStatusCmd(options);
};

/**
 * List generated Chrome cache inventory.
 *
 * @param options - Options that configure the operation.
 * @returns Completes when `runCacheList` finishes.
 * @example
 * ```ts
 * await runCacheList(options);
 * ```
 */
export const runCacheList = async (options: CacheCmdOptions = {}): Promise<void> => {
  await runCacheListCmd(options);
};

/**
 * Prune generated Chrome cache inventory.
 *
 * @param options - Options that configure the operation.
 * @returns Completes when `runCachePrune` finishes.
 * @example
 * ```ts
 * await runCachePrune(options);
 * ```
 */
export const runCachePrune = async (options: CacheCmdOptions = {}): Promise<void> => {
  await runCachePruneCmd(options);
};

/**
 * Close the warm Chrome instance holding the debug port.
 *
 * @returns Completes when `runStop` finishes.
 * @example
 * ```ts
 * await runStop();
 * ```
 */
export const runStop = async (): Promise<void> => {
  const runner = new CliRunner();
  await runner.runStop();
};

/**
 * Print stored bridge sessions (newest first) as JSON.
 *
 * @returns Completes when `runSessions` finishes.
 * @example
 * ```ts
 * await runSessions();
 * ```
 */
export const runSessions = async (): Promise<void> => {
  const runner = new CliRunner();
  await runner.runSessions();
};
