import { McpServer as McpProtocolServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { Page } from "playwright";
import { z } from "zod";
import type { ToolDef, ToolResult } from "../domain/types.ts";
import type { BridgePermissionMode } from "../domain/types.ts";
import { evaluateToolPermission, permissionDecisionToToolResult } from "../domain/permissions.ts";
import { loadManifest } from "../providers/chatgpt/chatgpt-page.class.ts";
import { createCheckpoint } from "../store/checkpoints.ts";
import { appendBridgeLog } from "../store/logging.ts";
import type { HookDefinition } from "../user-config/hooks.ts";
import { runHooks } from "../user-config/hooks.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Lifecycle event emitted when an MCP tool runs. */
export interface McpToolAction {
  name: string;
  status: "started" | "completed" | "blocked" | "failed";
  data?: Record<string, unknown>;
}

/** Hooks and callbacks wired into the MCP server. */
export interface McpServerOptions {
  getPage?: () => Page | null | undefined;
  getPermissionMode?: () => BridgePermissionMode;
  hooks?: readonly HookDefinition[];
  onToolAction?: (action: McpToolAction) => void | Promise<void>;
}

/** A running MCP server: its local base URL and a handle to stop it. */
export interface McpServerHandle {
  url: string;
  close: () => void;
}

/** Internal SSE transport pairing. */
interface McpConnection {
  server: McpProtocolServer;
  transport: SSEServerTransport;
}

/** Internal streamable HTTP transport pairing. */
interface StreamableMcpConnection {
  server: McpProtocolServer;
  transport: StreamableHTTPServerTransport;
}

// ---------------------------------------------------------------------------
// Sandbox
// ---------------------------------------------------------------------------

/** Ensure a user-supplied path resolves inside the repo root. */
export function ensureInsideRepo(path: string, repoRoot: string): string {
  const resolved = resolve(repoRoot, path);
  const normalizedRoot = resolve(repoRoot);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + "/")) {
    throw new Error(`Path escapes repo root: ${path}`);
  }
  return resolved;
}

/** Allowlisted test command prefixes — only these may be executed. */
const ALLOWED_TEST_PREFIXES: string[][] = [
  ["npm", "test"],
  ["npm", "run", "test"],
  ["pnpm", "test"],
  ["pnpm", "run", "test"],
  ["yarn", "test"],
  ["pytest"],
  ["python", "-m", "pytest"],
  ["go", "test"],
  ["cargo", "test"],
  ["make", "test"],
];

/** Check whether a parsed command matches an allowed test prefix. */
export function isAllowedTestCommand(parts: string[]): boolean {
  return ALLOWED_TEST_PREFIXES.some(
    (prefix) => parts.slice(0, prefix.length).join(" ") === prefix.join(" "),
  );
}

/** Trim output to a max character limit. */
export function trimOutput(text: string, limit = 20_000): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + `\n\n[trimmed: output exceeded ${limit} chars]`;
}

// ---------------------------------------------------------------------------
// Process
// ---------------------------------------------------------------------------

interface ProcessResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

interface RunProcessOptions {
  timeoutMs?: number;
  stdin?: string;
}

interface SpawnProcessInput {
  command: string;
  args: string[];
  cwd: string;
  stdin?: string;
  timeoutMs: number;
}

/** Run a subprocess without a shell and capture stdout/stderr. */
function runProcess(
  args: readonly string[],
  cwd: string,
  options: RunProcessOptions = {},
): Promise<ProcessResult> {
  if (args.length === 0) return Promise.resolve({ stdout: "", stderr: "Empty command.", code: 1 });
  const [command, ...rest] = args;
  return spawnProcess({
    command,
    args: rest,
    cwd,
    stdin: options.stdin,
    timeoutMs: options.timeoutMs ?? 30_000,
  });
}

/** Spawn a subprocess and resolve when it exits or times out. */
function spawnProcess(input: SpawnProcessInput): Promise<ProcessResult> {
  return new Promise((done) => {
    const proc = spawn(input.command, input.args, { cwd: input.cwd });
    attachProcessListeners({ proc, timeoutMs: input.timeoutMs, done });
    writeProcessStdin({ proc, stdin: input.stdin });
  });
}

function attachProcessListeners(input: {
  proc: ChildProcess;
  timeoutMs: number;
  done: (result: ProcessResult) => void;
}): void {
  const output = { stdout: "", stderr: "" };
  const timer = setTimeout(() => { input.proc.kill(); }, input.timeoutMs);
  attachProcessOutput({ proc: input.proc, output });
  attachProcessCompletion({ proc: input.proc, timer, output, done: input.done });
}

function attachProcessOutput(input: { proc: ChildProcess; output: { stdout: string; stderr: string } }): void {
  input.proc.stdout?.on("data", (chunk: Buffer) => { input.output.stdout += chunk.toString(); });
  input.proc.stderr?.on("data", (chunk: Buffer) => { input.output.stderr += chunk.toString(); });
}

function attachProcessCompletion(input: {
  proc: ChildProcess;
  timer: NodeJS.Timeout;
  output: { stdout: string; stderr: string };
  done: (result: ProcessResult) => void;
}): void {
  input.proc.on("close", (code) => {
    clearTimeout(input.timer);
    input.done({ stdout: input.output.stdout, stderr: input.output.stderr, code });
  });
  input.proc.on("error", (err) => {
    clearTimeout(input.timer);
    input.done({ stdout: input.output.stdout, stderr: err.message, code: 1 });
  });
}

function writeProcessStdin(input: { proc: ChildProcess; stdin?: string }): void {
  if (input.stdin === undefined) return;
  input.proc.stdin?.write(input.stdin);
  input.proc.stdin?.end();
}

// ---------------------------------------------------------------------------
// Read file
// ---------------------------------------------------------------------------

interface ReadFileSliceInput {
  safePath: string;
  path: string;
  startLine: number;
  maxLines: number;
}

async function readNumberedSlice(input: ReadFileSliceInput): Promise<{ ok: true; output: string }> {
  const raw = await readFile(input.safePath, "utf-8");
  const lines = raw.split("\n");
  const start = Math.max(input.startLine - 1, 0);
  const end = Math.min(start + input.maxLines, lines.length);
  return { ok: true, output: trimOutput(buildNumberedSliceOutput({ lines, start, end, path: input.path })) };
}

function buildNumberedSliceOutput(input: { lines: string[]; start: number; end: number; path: string }): string {
  const header = `path: ${input.path}\nlines: ${input.start + 1}-${input.end} of ${input.lines.length}\n`;
  return header + formatNumberedLines({ lines: input.lines, start: input.start, end: input.end });
}

function formatNumberedLines(input: { lines: string[]; start: number; end: number }): string {
  let text = "";
  for (let index = input.start; index < input.end; index += 1) {
    text += `${index + 1}: ${input.lines[index]}\n`;
  }
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

async function readFileTool(args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
  const input = readFileToolInput(args);
  const invalid = await assertReadableFile({ safePath: input.safePath, path: input.path });
  if (invalid) return invalid;
  return await readNumberedSlice(input);
}

function readFileToolInput(args: Record<string, unknown>): ReadFileSliceInput {
  const path = String(args.path);
  const repoRoot = String(args._repoRoot);
  return {
    path,
    safePath: ensureInsideRepo(path, repoRoot),
    startLine: Number(args.start_line ?? 1),
    maxLines: Number(args.max_lines ?? 200),
  };
}

async function assertReadableFile(input: { safePath: string; path: string }): Promise<{ ok: false; output: string } | null> {
  try {
    const fileStat = await stat(input.safePath);
    if (!fileStat.isFile()) return { ok: false, output: `Not a file: ${input.path}` };
  } catch {
    return { ok: false, output: `File not found: ${input.path}` };
  }
  return null;
}

const readFileDef: ToolDef = {
  name: "read_file",
  description: "Read a repo file with line numbers. Use after grep_code before proposing edits.",
  annotations: { title: "Read file", readOnlyHint: true, openWorldHint: false },
  parameters: {
    path: z.string().describe("Repo-relative file path."),
    start_line: z.number().optional().describe("1-based line number to start reading."),
    max_lines: z.number().optional().describe("Maximum number of lines to read."),
  },
  handler: readFileTool,
};

// ---------------------------------------------------------------------------
// Grep
// ---------------------------------------------------------------------------

interface BuildRgArgsInput {
  pattern: string;
  safePath: string;
  glob?: string;
}

function buildRgArgs(input: BuildRgArgsInput): string[] {
  const rgArgs = [
    "rg", "--line-number", "--hidden",
    "--glob", "!.git", "--glob", "!node_modules", "--glob", "!dist", "--glob", "!build",
  ];
  if (input.glob) rgArgs.push("--glob", input.glob);
  rgArgs.push(input.pattern, input.safePath);
  return rgArgs;
}

function grepResultOutput(result: ProcessResult): { ok: boolean; output: string } {
  if (result.code === 1) return { ok: true, output: "" };
  if (result.code !== 0) return { ok: false, output: result.stderr };
  return { ok: true, output: trimOutput(result.stdout) };
}

async function grepCode(args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
  const input = readGrepInput(args);
  const result = await runProcess(buildRgArgs(input), input.repoRoot, { timeoutMs: 20_000 });
  return grepResultOutput(result);
}

function readGrepInput(args: Record<string, unknown>): BuildRgArgsInput & { repoRoot: string } {
  const repoRoot = String(args._repoRoot);
  return {
    pattern: String(args.pattern),
    safePath: ensureInsideRepo(String(args.path), repoRoot),
    glob: args.glob ? String(args.glob) : undefined,
    repoRoot,
  };
}

const grepTool: ToolDef = {
  name: "grep_code",
  description: "Search the repository using ripgrep. Locate symbols, imports, routes, tests, configs, and references.",
  annotations: { title: "Search repo", readOnlyHint: true, openWorldHint: false },
  parameters: {
    pattern: z.string().describe("The ripgrep search pattern."),
    path: z.string().describe("Repo-relative path to search."),
    glob: z.string().optional().describe("Optional ripgrep glob, e.g. '*.ts'."),
  },
  handler: grepCode,
};

// ---------------------------------------------------------------------------
// Apply patch
// ---------------------------------------------------------------------------

interface ApplyPatchInput {
  patch: string;
  repoRoot: string;
  patchPaths: string[];
}

async function runGitApply(input: ApplyPatchInput): Promise<{ ok: boolean; output: string }> {
  const check = await runProcess(["git", "apply", "--check", "-"], input.repoRoot, { stdin: input.patch, timeoutMs: 20_000 });
  if (check.code !== 0) {
    return { ok: false, output: `Patch check failed:\n${trimOutput(check.stderr || check.stdout)}` };
  }
  const applied = await runProcess(["git", "apply", "-"], input.repoRoot, { stdin: input.patch, timeoutMs: 20_000 });
  if (applied.code !== 0) {
    return { ok: false, output: `Patch apply failed:\n${trimOutput(applied.stderr || applied.stdout)}` };
  }
  return { ok: true, output: "Patch applied successfully." };
}

async function createPatchCheckpoints(input: ApplyPatchInput): Promise<string> {
  if (input.patchPaths.length === 0) return "";
  const before = await createCheckpoint({ repoRoot: input.repoRoot, paths: input.patchPaths, phase: "before", label: "apply_patch" });
  const after = await createCheckpoint({ repoRoot: input.repoRoot, paths: input.patchPaths, phase: "after", label: "apply_patch" });
  return `\nCheckpoints:\n- before: ${before.id}\n- after: ${after.id}`;
}

async function applyPatch(args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
  const input = readApplyPatchInput(args);
  ensureInsideRepo(".", input.repoRoot);
  const patchPaths = extractPatchPaths(input.patch);
  const applied = await runGitApply({ patch: input.patch, repoRoot: input.repoRoot, patchPaths });
  return applied.ok
    ? { ok: true, output: applied.output + await createPatchCheckpoints({ patch: input.patch, repoRoot: input.repoRoot, patchPaths }) }
    : applied;
}

function readApplyPatchInput(args: Record<string, unknown>): { patch: string; repoRoot: string } {
  return { patch: String(args.patch), repoRoot: String(args._repoRoot) };
}

/** Extract changed file paths from a unified git patch. */
export function extractPatchPaths(patch: string): string[] {
  const paths = new Set<string>();
  for (const line of patch.split(/\r?\n/)) {
    const gitMatch = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (gitMatch) {
      addPatchPath({ paths, path: gitMatch[1] });
      addPatchPath({ paths, path: gitMatch[2] });
      continue;
    }
    const fileMatch = /^(---|\+\+\+) (?:a|b)\/(.+)$/.exec(line);
    if (fileMatch) addPatchPath({ paths, path: fileMatch[2] });
  }
  return [...paths];
}

function addPatchPath(input: { paths: Set<string>; path: string }): void {
  const trimmed = input.path.trim();
  if (!trimmed || trimmed === "/dev/null") return;
  input.paths.add(trimmed);
}

const applyPatchTool: ToolDef = {
  name: "apply_patch",
  description: "Apply a unified diff patch to the repository. Use only after reading the relevant files.",
  annotations: { title: "Apply patch", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  parameters: { patch: z.string().describe("Unified diff patch compatible with git apply.") },
  handler: applyPatch,
};

// ---------------------------------------------------------------------------
// Run tests
// ---------------------------------------------------------------------------

async function runTests(args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
  const command = String(args.command);
  const repoRoot = String(args._repoRoot);
  const denied = validateTestCommand({ parts: command.trim().split(/\s+/), command });
  if (denied) return denied;
  return formatTestResult(await runProcess(command.trim().split(/\s+/), repoRoot, { timeoutMs: 120_000 }));
}

function validateTestCommand(input: { parts: string[]; command: string }): { ok: false; output: string } | null {
  if (input.parts.length === 0) return { ok: false, output: "Empty command." };
  if (!isAllowedTestCommand(input.parts)) {
    return { ok: false, output: `Command not allowlisted: ${input.command}\nAllowed: npm test, pnpm test, pytest, go test ./..., cargo test, make test` };
  }
  return null;
}

function formatTestResult(result: ProcessResult): { ok: boolean; output: string } {
  const combined = result.stdout + "\n" + result.stderr;
  return { ok: result.code === 0, output: trimOutput(combined.trim()) };
}

const runTestsTool: ToolDef = {
  name: "run_tests",
  description: "Run an allowed project test command (npm test, pytest, go test, etc.).",
  annotations: { title: "Run tests", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  parameters: { command: z.string().describe("Allowed test command, e.g. 'npm test' or 'pytest'.") },
  handler: runTests,
};

// ---------------------------------------------------------------------------
// Git diff
// ---------------------------------------------------------------------------

async function gitDiff(args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
  const repoRoot = String(args._repoRoot);
  const [stat, diff] = await Promise.all([
    runProcess(["git", "diff", "--stat"], repoRoot, { timeoutMs: 10_000 }),
    runProcess(["git", "diff"], repoRoot, { timeoutMs: 20_000 }),
  ]);
  const combined = `--- stat ---\n${stat.stdout}\n\n--- diff ---\n${diff.stdout}`;
  return { ok: true, output: trimOutput(combined) };
}

const gitDiffTool: ToolDef = {
  name: "git_diff",
  description: "Show the current git diff and diff stat for the working tree.",
  annotations: { title: "Show git diff", readOnlyHint: true, openWorldHint: false },
  parameters: {},
  handler: gitDiff,
};

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

const DOWNLOADER_MODULE = "../providers/chatgpt/chatgpt-page.class.ts";

interface SingleDownloadResult {
  path: string;
  bytes: number;
}

interface DownloadResult {
  id?: string;
  path: string;
  bytes: number;
  error?: string;
}

interface AttachmentDownloaderModule {
  downloadAttachment(page: Page, conversationId: string, id: string, opts?: { outDir?: string }): Promise<unknown>;
  downloadAll(page: Page, conversationId: string, opts?: { outDir?: string; ids?: string[] }): Promise<unknown>;
}

function jsonResult(value: unknown): ToolResult {
  return { ok: true, output: JSON.stringify(value) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeSingleDownloadResult(value: unknown): SingleDownloadResult {
  if (!isRecord(value)) return { path: String(value), bytes: 0 };
  return {
    path: typeof value.path === "string" ? value.path : "",
    bytes: typeof value.bytes === "number" ? value.bytes : 0,
  };
}

function normalizeDownloadResult(value: unknown, fallbackId: string): DownloadResult {
  if (!isRecord(value)) return { id: fallbackId, path: String(value), bytes: 0 };
  return {
    id: typeof value.id === "string" ? value.id : fallbackId,
    path: typeof value.path === "string" ? value.path : "",
    bytes: typeof value.bytes === "number" ? value.bytes : 0,
    error: typeof value.error === "string" ? value.error : undefined,
  };
}

function normalizeDownloadAll(value: unknown): DownloadResult[] {
  if (!Array.isArray(value)) return [];
  const results: DownloadResult[] = [];
  for (let index = 0; index < value.length; index += 1) {
    results.push(normalizeDownloadResult(value[index], `attachment-${index + 1}`));
  }
  return results;
}

function optionalPage(value: unknown): Page | null {
  if (typeof value !== "object" || value === null || typeof (value as Page).url !== "function") return null;
  return value as Page;
}

function resolveConversationId(args: Record<string, unknown>): string {
  const explicit = typeof args.conversationId === "string" && args.conversationId.length > 0
    ? args.conversationId
    : undefined;
  if (explicit) return explicit;
  const page = optionalPage(args._page);
  if (!page) throw new Error("No active ChatGPT browser page is available.");
  const match = /\/c\/([^/?#]+)/.exec(page.url());
  return match?.[1] ?? "current";
}

function resolvePage(args: Record<string, unknown>): Page {
  const page = optionalPage(args._page);
  if (!page) throw new Error("No active ChatGPT browser page is available.");
  return page;
}

async function loadDownloader(): Promise<AttachmentDownloaderModule> {
  return await import(DOWNLOADER_MODULE) as AttachmentDownloaderModule;
}

/** MCP tool for listing attachments captured in the active ChatGPT conversation. */
export const listAttachmentsTool: ToolDef = {
  name: "chatgpt_list_attachments",
  description: "List captured attachments in a ChatGPT conversation, including their assistant/user role.",
  annotations: { title: "List ChatGPT attachments", readOnlyHint: true, openWorldHint: false },
  parameters: { conversationId: z.string().optional().describe("Optional ChatGPT conversation id.") },
  handler: async (args) => jsonResult((await loadManifest(resolveConversationId(args))).attachments),
};

/** MCP tool for downloading one captured ChatGPT attachment. */
export const downloadAttachmentTool: ToolDef = {
  name: "chatgpt_download_attachment",
  description: "Download one captured attachment from the active ChatGPT conversation.",
  annotations: { title: "Download ChatGPT attachment", readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  parameters: {
    conversationId: z.string().optional().describe("Optional ChatGPT conversation id."),
    id: z.string().describe("Attachment id from chatgpt_list_attachments."),
    outDir: z.string().optional().describe("Optional output directory."),
  },
  handler: async (args) => {
    const outDir = optionalString(args.outDir);
    const raw = await (await loadDownloader()).downloadAttachment(
      resolvePage(args), resolveConversationId(args), String(args.id), outDir ? { outDir } : undefined,
    );
    return jsonResult(normalizeSingleDownloadResult(raw));
  },
};

/** MCP tool for downloading all or selected captured ChatGPT attachments. */
export const downloadAllAttachmentsTool: ToolDef = {
  name: "chatgpt_download_all",
  description: "Download all or selected captured attachments from the active ChatGPT conversation.",
  annotations: { title: "Download all ChatGPT attachments", readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  parameters: {
    conversationId: z.string().optional().describe("Optional ChatGPT conversation id."),
    outDir: z.string().optional().describe("Optional output directory."),
    ids: z.array(z.string()).optional().describe("Optional attachment ids to download."),
  },
  handler: async (args) => {
    const outDir = optionalString(args.outDir);
    const ids = Array.isArray(args.ids) ? args.ids.filter((id): id is string => typeof id === "string") : undefined;
    const raw = await (await loadDownloader()).downloadAll(resolvePage(args), resolveConversationId(args), {
      ...(outDir ? { outDir } : {}),
      ...(ids ? { ids } : {}),
    });
    return jsonResult(normalizeDownloadAll(raw));
  },
};

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

const toolRegistry: Map<string, ToolDef> = new Map();

for (const tool of [grepTool, readFileDef, applyPatchTool, runTestsTool, gitDiffTool, listAttachmentsTool, downloadAttachmentTool, downloadAllAttachmentsTool]) {
  toolRegistry.set(tool.name, tool);
}

/** All available MCP tools, indexed by name. */
export { toolRegistry };

// ---------------------------------------------------------------------------
// Tool call handling
// ---------------------------------------------------------------------------

function toolActionStatus(result: ToolResult, blocked: boolean): McpToolAction["status"] {
  if (blocked) return "blocked";
  return result.ok ? "completed" : "failed";
}

function sanitizeToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (key === "_repoRoot") continue;
    clean[key] = value;
  }
  return clean;
}

async function handleToolCall(input: {
  repoRoot: string;
  options: McpServerOptions;
  name: string;
  tool: { handler: (args: Record<string, unknown>) => Promise<ToolResult> };
  args: Record<string, unknown>;
}) {
  await runHooks("PreToolUse", input.options.hooks ?? []).catch(() => []);
  const result = await executeToolCall(input);
  await runHooks("PostToolUse", input.options.hooks ?? []).catch(() => []);
  return { content: [{ type: "text" as const, text: result.output }], isError: !result.ok };
}

async function executeToolCall(input: {
  repoRoot: string;
  options: McpServerOptions;
  name: string;
  tool: { handler: (args: Record<string, unknown>) => Promise<ToolResult> };
  args: Record<string, unknown>;
}): Promise<ToolResult> {
  await logToolCallStart(input);
  const denied = permissionDecisionToToolResult(
    evaluateToolPermission(input.name, input.options.getPermissionMode?.() ?? "auto"),
  );
  const result = await invokeToolHandler({ ...input, denied: denied ?? undefined });
  await logToolCallEnd({ params: input, result, blocked: denied !== undefined });
  return result;
}

async function invokeToolHandler(input: {
  repoRoot: string;
  options: McpServerOptions;
  name: string;
  tool: { handler: (args: Record<string, unknown>) => Promise<ToolResult> };
  args: Record<string, unknown>;
  denied?: ToolResult;
}): Promise<ToolResult> {
  if (input.denied) return input.denied;
  try {
    const page = input.options.getPage?.();
    return await input.tool.handler({
      ...input.args,
      _repoRoot: input.repoRoot,
      ...(page ? { _page: page } : {}),
    });
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error), error: "tool-handler-error" };
  }
}

async function logToolCallStart(input: {
  repoRoot: string;
  options: McpServerOptions;
  name: string;
  args: Record<string, unknown>;
}): Promise<void> {
  const clean = sanitizeToolArgs(input.args);
  await appendBridgeLog({ repoPath: input.repoRoot, type: "mcp_tool_call", data: { name: input.name, args: clean } }).catch(() => {});
  await input.options.onToolAction?.({ name: input.name, status: "started", data: { args: clean } });
}

async function logToolCallEnd(input: {
  params: { repoRoot: string; options: McpServerOptions; name: string };
  result: ToolResult;
  blocked: boolean;
}): Promise<void> {
  await appendBridgeLog({
    repoPath: input.params.repoRoot,
    type: "mcp_tool_result",
    data: { name: input.params.name, ok: input.result.ok, outputBytes: input.result.output.length, error: input.result.error },
  }).catch(() => {});
  const status = toolActionStatus(input.result, input.blocked);
  await input.params.options.onToolAction?.({
    name: input.params.name,
    status,
    data: { ok: input.result.ok, error: input.result.error, outputBytes: input.result.output.length },
  });
}

function createMcpProtocolServer(repoRoot: string, options: McpServerOptions): McpProtocolServer {
  const mcp = new McpProtocolServer({ name: "ai-browser-bridge", version: "0.1.0" });
  for (const [name, tool] of toolRegistry) {
    mcp.tool(name, tool.description, tool.parameters, tool.annotations ?? {}, async (args: Record<string, unknown>) => {
      return handleToolCall({ repoRoot, options, name, tool, args });
    });
  }
  return mcp;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/** Whether the pathname is an SSE MCP endpoint. */
export function isSseEndpointPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/sse" || pathname === "/sse/";
}

/** Whether the pathname is a streamable HTTP MCP endpoint. */
export function isStreamableHttpEndpointPath(pathname: string): boolean {
  return pathname === "/mcp" || pathname === "/mcp/";
}

function requestPathname(url: string | undefined): string {
  try {
    return new URL(url ?? "/", "http://localhost").pathname;
  } catch {
    return "/";
  }
}

function requestHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : undefined;
}

function writeJsonRpcError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({
    jsonrpc: "2.0",
    error: { code: -32000, message },
    id: null,
  }));
}

function writeSseProxyFlushPadding(res: ServerResponse): void {
  if (res.writableEnded) return;
  res.write(`: ${" ".repeat(2048)}\n\n`);
}

// ---------------------------------------------------------------------------
// McpServer
// ---------------------------------------------------------------------------

/** MCP HTTP server with SSE and streamable HTTP transports and sandboxed repo tools. */
export class McpServer {
  private readonly repoRoot: string;
  private readonly options: McpServerOptions;
  private httpServer: ReturnType<typeof createServer> | null = null;
  private readonly connections = new Map<string, McpConnection>();
  private readonly streamableConnections = new Map<string, StreamableMcpConnection>();

  /** Create an MCP server bound to a repo root and optional hooks/callbacks. */
  constructor(repoRoot: string, options: McpServerOptions = {}) {
    this.repoRoot = repoRoot;
    this.options = options;
  }

  /** Start listening on the given port and return the local base URL. */
  async start(port: number): Promise<string> {
    this.httpServer = createServer((req, res) => { void this.handleRequest(req, res); });
    await this.listenOnPort(port);
    return `http://localhost:${port}`;
  }

  /** Close all active connections and shut down the HTTP server. */
  stop(): void {
    this.closeAllConnections(this.connections);
    this.closeAllConnections(this.streamableConnections);
    this.httpServer?.close();
    this.httpServer = null;
  }

  /** Route an HTTP request to streamable HTTP, SSE, or POST /messages handlers. */
  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const pathname = requestPathname(req.url);
    if (isStreamableHttpEndpointPath(pathname)) {
      await this.handleStreamableHttpRequest(req, res);
      return;
    }
    if (isSseEndpointPath(pathname)) {
      await this.handleSseRequest(req, res);
      return;
    }
    if (pathname === "/messages" && req.method === "POST") {
      await this.handleSsePostMessage(req, res);
      return;
    }
    res.writeHead(404).end("Not found");
  }

  /** Return all registered MCP tool definitions. */
  listTools(): ToolDef[] {
    return [...toolRegistry.values()];
  }

  /** Bind the HTTP server to a port, rejecting on listen errors. */
  private async listenOnPort(port: number): Promise<void> {
    const server = this.httpServer;
    if (!server) throw new Error("HTTP server not initialized");
    const listenError = await new Promise<Error | undefined>((done) => {
      const onError = (err: Error) => done(err);
      server.once("error", onError);
      server.listen(port, () => {
        server.off("error", onError);
        done(undefined);
      });
    });
    if (listenError) throw listenError;
  }

  /** Close every MCP protocol server in a connection map. */
  private closeAllConnections(connections: Map<string, McpConnection | StreamableMcpConnection>): void {
    for (const connection of connections.values()) connection.server.close().catch(() => {});
    connections.clear();
  }

  /** Accept a new SSE MCP session and connect the protocol server. */
  private async handleSseRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const transport = new SSEServerTransport("/messages", res);
    const mcp = createMcpProtocolServer(this.repoRoot, this.options);
    this.connections.set(transport.sessionId, { server: mcp, transport });
    transport.onclose = () => this.connections.delete(transport.sessionId);
    try {
      await mcp.connect(transport);
      writeSseProxyFlushPadding(res);
    } catch (error) {
      this.connections.delete(transport.sessionId);
      if (!res.headersSent) {
        res.writeHead(500).end(error instanceof Error ? error.message : String(error));
      }
    }
  }

  /** Forward a POST /messages request to the matching SSE session transport. */
  private async handleSsePostMessage(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessionId = new URL(req.url ?? "/", "http://localhost").searchParams.get("sessionId");
    const connection = sessionId ? this.connections.get(sessionId) : undefined;
    if (connection) {
      await connection.transport.handlePostMessage(req, res);
      return;
    }
    res.writeHead(503).end("No active SSE connection");
  }

  /** Route a streamable HTTP MCP request to an existing or new session. */
  private async handleStreamableHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessionId = requestHeader(req.headers["mcp-session-id"]);
    let connection = sessionId ? this.streamableConnections.get(sessionId) : undefined;
    let parsedBody: unknown;
    if (!connection) {
      const created = await this.createStreamableConnection(req, res);
      if (!created) return;
      connection = created.connection;
      parsedBody = created.parsedBody;
    }
    try {
      await connection.transport.handleRequest(req, res, parsedBody);
    } catch (error) {
      if (!res.headersSent) {
        writeJsonRpcError(res, 500, error instanceof Error ? error.message : "Internal server error");
      }
    }
  }

  /** Create a new streamable HTTP session when no session id is provided. */
  private async createStreamableConnection(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<{ connection: StreamableMcpConnection; parsedBody: unknown } | null> {
    const sessionId = requestHeader(req.headers["mcp-session-id"]);
    if (sessionId) {
      writeJsonRpcError(res, 404, "Session not found");
      return null;
    }
    if (req.method !== "POST") {
      writeJsonRpcError(res, 400, "Bad Request: No valid session ID provided");
      return null;
    }
    const parsedBody = await readJsonBody(req);
    if (!isInitializeRequest(parsedBody)) {
      writeJsonRpcError(res, 400, "Bad Request: No valid session ID provided");
      return null;
    }
    const connection = await this.openStreamableConnection();
    return { connection, parsedBody };
  }

  /** Open a streamable HTTP transport and connect the MCP protocol server. */
  private async openStreamableConnection(): Promise<StreamableMcpConnection> {
    let createdConnection: StreamableMcpConnection | null = null;
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        if (createdConnection) this.streamableConnections.set(newSessionId, createdConnection);
      },
    });
    createdConnection = { server: createMcpProtocolServer(this.repoRoot, this.options), transport };
    transport.onclose = () => {
      const closedSessionId = transport.sessionId;
      if (closedSessionId) this.streamableConnections.delete(closedSessionId);
    };
    await createdConnection.server.connect(transport);
    return createdConnection;
  }
}
