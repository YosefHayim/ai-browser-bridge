import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Page } from "playwright";
import { DEFAULT_PERMISSION_MODE } from "@/config";
import type { PermissionMode, ToolDef, ToolResult } from "@/features/domain";
import { evaluateToolPermission, permissionDecisionToToolResult } from "@/features/domain";
import {
  chatGptConversationIdFromUrl,
  downloadAll,
  downloadAttachment,
  loadManifest,
} from "@/features/providers";
import { appendBridgeLog, createCheckpoint, downloadsDir, repositoryPath } from "@/features/store";
import type { HookDefinition } from "@/features/userConfig";
import { runHooks } from "@/features/userConfig";
import { effectSchemaToMcpShape } from "./mcpEffectAdapter.ts";
import {
  ApplyPatchArgsSchema,
  DownloadAllAttachmentsArgsSchema,
  DownloadAttachmentArgsSchema,
  GitDiffArgsSchema,
  GrepCodeArgsSchema,
  ListAttachmentsArgsSchema,
  ReadFileArgsSchema,
  RunTestsArgsSchema,
} from "./toolsSchemas.ts";

// Only these argv prefixes may run under run_tests (no shell).
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

export type McpToolAction = {
  name: string;
  status: "started" | "completed" | "blocked" | "failed";
  data?: Record<string, unknown>;
};

export type McpServerOptions = {
  getPage?: () => Page | null | undefined;
  getPermissionMode?: () => PermissionMode;
  hooks?: readonly HookDefinition[];
  onToolAction?: (action: McpToolAction) => void | Promise<void>;
};

export type McpServerHandle = {
  url: string;
  close: () => void;
};

type McpConnection = {
  server: McpServer;
  transport: SSEServerTransport;
};

type StreamableMcpConnection = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
};

export const isAllowedTestCommand = (parts: string[]): boolean => {
  return ALLOWED_TEST_PREFIXES.some(
    (prefix) => parts.slice(0, prefix.length).join(" ") === prefix.join(" "),
  );
};

export const trimOutput = (text: string, limit = 20_000): string => {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n[trimmed: output exceeded ${limit} chars]`;
};

type ProcessOutcome = {
  stdout: string;
  stderr: string;
  code: number | null;
};

type RunProcessOptions = {
  timeoutMs?: number;
  stdin?: string;
};

type SpawnProcessInput = {
  command: string;
  args: string[];
  cwd: string;
  stdin?: string;
  timeoutMs: number;
};

const runProcess = (
  args: readonly string[],
  cwd: string,
  options: RunProcessOptions = {},
): Promise<ProcessOutcome> => {
  if (args.length === 0) return Promise.resolve({ stdout: "", stderr: "Empty command.", code: 1 });
  const [command = "", ...rest] = args;
  const timeoutMs = options.timeoutMs === undefined ? 30_000 : options.timeoutMs;
  return spawnProcess({
    command,
    args: rest,
    cwd,
    stdin: options.stdin,
    timeoutMs,
  });
};

const spawnProcess = (input: SpawnProcessInput): Promise<ProcessOutcome> => {
  return new Promise((done) => {
    const proc = spawn(input.command, input.args, { cwd: input.cwd });
    attachProcessListeners({ proc, timeoutMs: input.timeoutMs, done });
    writeProcessStdin({ proc, stdin: input.stdin });
  });
};

const attachProcessListeners = (input: {
  proc: ChildProcess;
  timeoutMs: number;
  done: (outcome: ProcessOutcome) => void;
}): void => {
  const output = { stdout: "", stderr: "" };
  const timer = setTimeout(() => {
    input.proc.kill();
  }, input.timeoutMs);
  attachProcessOutput({ proc: input.proc, output });
  attachProcessCompletion({ proc: input.proc, timer, output, done: input.done });
};

const attachProcessOutput = (input: {
  proc: ChildProcess;
  output: { stdout: string; stderr: string };
}): void => {
  input.proc.stdout?.on("data", (chunk: Buffer) => {
    input.output.stdout += chunk.toString();
  });
  input.proc.stderr?.on("data", (chunk: Buffer) => {
    input.output.stderr += chunk.toString();
  });
};

const attachProcessCompletion = (input: {
  proc: ChildProcess;
  timer: NodeJS.Timeout;
  output: { stdout: string; stderr: string };
  done: (outcome: ProcessOutcome) => void;
}): void => {
  input.proc.on("close", (code) => {
    clearTimeout(input.timer);
    input.done({ stdout: input.output.stdout, stderr: input.output.stderr, code });
  });
  input.proc.on("error", (err) => {
    clearTimeout(input.timer);
    input.done({ stdout: input.output.stdout, stderr: err.message, code: 1 });
  });
};

const writeProcessStdin = (input: { proc: ChildProcess; stdin?: string }): void => {
  if (input.stdin === undefined) return;
  input.proc.stdin?.write(input.stdin);
  input.proc.stdin?.end();
};

type ReadFileSliceInput = {
  safePath: string;
  path: string;
  startLine: number;
  maxLines: number;
};

const readNumberedSlice = async (
  input: ReadFileSliceInput,
): Promise<{ ok: true; output: string }> => {
  const raw = await readFile(input.safePath, "utf-8");
  const lines = raw.split("\n");
  const start = Math.max(input.startLine - 1, 0);
  const end = Math.min(start + input.maxLines, lines.length);
  return {
    ok: true,
    output: trimOutput(numberedSliceOutput({ lines, start, end, path: input.path })),
  };
};

const numberedSliceOutput = (input: {
  lines: string[];
  start: number;
  end: number;
  path: string;
}): string => {
  const header = `path: ${input.path}\nlines: ${input.start + 1}-${input.end} of ${input.lines.length}\n`;
  return header + formatNumberedLines({ lines: input.lines, start: input.start, end: input.end });
};

const formatNumberedLines = (input: { lines: string[]; start: number; end: number }): string => {
  let text = "";
  for (let index = input.start; index < input.end; index += 1) {
    text += `${index + 1}: ${input.lines[index]}\n`;
  }
  return text.endsWith("\n") ? text.slice(0, -1) : text;
};

const readFileTool = async (
  args: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> => {
  const input = readFileToolInput(args);
  const invalid = await assertReadableFile({ safePath: input.safePath, path: input.path });
  if (invalid) return invalid;
  return await readNumberedSlice(input);
};

const readFileToolInput = (args: Record<string, unknown>): ReadFileSliceInput => {
  const path = String(args.path);
  const repoRoot = String(args._repoRoot);
  const startLine = args.start_line === undefined ? 1 : Number(args.start_line);
  const maxLines = args.max_lines === undefined ? 200 : Number(args.max_lines);
  return {
    path,
    safePath: repositoryPath(repoRoot, path),
    startLine,
    maxLines,
  };
};

const assertReadableFile = async (input: {
  safePath: string;
  path: string;
}): Promise<{
  ok: false;
  output: string;
} | null> => {
  try {
    const fileStat = await stat(input.safePath);
    if (!fileStat.isFile()) return { ok: false, output: `Not a file: ${input.path}` };
  } catch {
    return { ok: false, output: `File not found: ${input.path}` };
  }
  return null;
};

const readFileToolDef: ToolDef = {
  name: "read_file",
  description: "Read a repo file with line numbers. Use after grep_code before proposing edits.",
  annotations: { title: "Read file", readOnlyHint: true, openWorldHint: false },
  argsSchema: ReadFileArgsSchema,
  handler: readFileTool,
};

type RgArgsInput = {
  pattern: string;
  safePath: string;
  glob?: string;
};

const ripgrepArgv = (input: RgArgsInput): string[] => {
  const argv = [
    "rg",
    "--line-number",
    "--hidden",
    "--glob",
    "!.git",
    "--glob",
    "!node_modules",
    "--glob",
    "!dist",
    "--glob",
    "!build",
  ];
  if (input.glob !== undefined) argv.push("--glob", input.glob);
  argv.push(input.pattern, input.safePath);
  return argv;
};

const toolResultFromGrep = (outcome: ProcessOutcome): { ok: boolean; output: string } => {
  if (outcome.code === 1) return { ok: true, output: "" };
  if (outcome.code !== 0) return { ok: false, output: outcome.stderr };
  return { ok: true, output: trimOutput(outcome.stdout) };
};

const grepCode = async (
  args: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> => {
  const input = readGrepInput(args);
  const outcome = await runProcess(ripgrepArgv(input), input.repoRoot, { timeoutMs: 20_000 });
  return toolResultFromGrep(outcome);
};

const readGrepInput = (args: Record<string, unknown>): RgArgsInput & { repoRoot: string } => {
  const repoRoot = String(args._repoRoot);
  const glob = args.glob === undefined ? undefined : String(args.glob);
  return {
    pattern: String(args.pattern),
    safePath: repositoryPath(repoRoot, String(args.path)),
    glob,
    repoRoot,
  };
};

const grepTool: ToolDef = {
  name: "grep_code",
  description:
    "Search the repository using ripgrep. Locate symbols, imports, routes, tests, configs, and references.",
  annotations: { title: "Search repo", readOnlyHint: true, openWorldHint: false },
  argsSchema: GrepCodeArgsSchema,
  handler: grepCode,
};

type ApplyPatchInput = {
  patch: string;
  repoRoot: string;
  patchPaths: string[];
};

const runGitApply = async (input: ApplyPatchInput): Promise<{ ok: boolean; output: string }> => {
  const check = await runProcess(["git", "apply", "--check", "-"], input.repoRoot, {
    stdin: input.patch,
    timeoutMs: 20_000,
  });
  if (check.code !== 0) {
    return {
      ok: false,
      output: `Patch check failed:\n${trimOutput(check.stderr || check.stdout)}`,
    };
  }
  const applied = await runProcess(["git", "apply", "-"], input.repoRoot, {
    stdin: input.patch,
    timeoutMs: 20_000,
  });
  if (applied.code !== 0) {
    return {
      ok: false,
      output: `Patch apply failed:\n${trimOutput(applied.stderr || applied.stdout)}`,
    };
  }
  return { ok: true, output: "Patch applied successfully." };
};

const createPatchCheckpoints = async (input: ApplyPatchInput): Promise<string> => {
  if (input.patchPaths.length === 0) return "";
  const before = await createCheckpoint({
    repoRoot: input.repoRoot,
    paths: input.patchPaths,
    phase: "before",
    label: "apply_patch",
  });
  const after = await createCheckpoint({
    repoRoot: input.repoRoot,
    paths: input.patchPaths,
    phase: "after",
    label: "apply_patch",
  });
  return `\nCheckpoints:\n- before: ${before.id}\n- after: ${after.id}`;
};

const applyPatch = async (
  args: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> => {
  const input = readApplyPatchInput(args);
  repositoryPath(input.repoRoot, ".");
  const patchPaths = extractPatchPaths(input.patch);
  const applied = await runGitApply({ patch: input.patch, repoRoot: input.repoRoot, patchPaths });
  if (!applied.ok) return applied;
  const checkpoints = await createPatchCheckpoints({
    patch: input.patch,
    repoRoot: input.repoRoot,
    patchPaths,
  });
  return { ok: true, output: applied.output + checkpoints };
};

const readApplyPatchInput = (
  args: Record<string, unknown>,
): { patch: string; repoRoot: string } => {
  return { patch: String(args.patch), repoRoot: String(args._repoRoot) };
};

const GIT_DIFF_HEADER = /^diff --git a\/(?<oldPath>.+?) b\/(?<newPath>.+)$/;
const GIT_FILE_MARKER = /^(?:---|\+\+\+) (?:a|b)\/(?<filePath>.+)$/;

export const extractPatchPaths = (patch: string): string[] => {
  const paths = new Set<string>();
  for (const line of patch.split(/\r?\n/)) {
    const gitMatch = GIT_DIFF_HEADER.exec(line);
    const gitPaths = gitMatch?.groups;
    if (gitPaths !== undefined) {
      if (gitPaths.oldPath !== undefined) addPatchPath({ paths, path: gitPaths.oldPath });
      if (gitPaths.newPath !== undefined) addPatchPath({ paths, path: gitPaths.newPath });
      continue;
    }
    const filePath = GIT_FILE_MARKER.exec(line)?.groups?.filePath;
    if (filePath !== undefined) addPatchPath({ paths, path: filePath });
  }
  return [...paths];
};

const addPatchPath = (input: { paths: Set<string>; path: string }): void => {
  const trimmed = input.path.trim();
  if (trimmed.length === 0 || trimmed === "/dev/null") return;
  input.paths.add(trimmed);
};

const applyPatchTool: ToolDef = {
  name: "apply_patch",
  description:
    "Apply a unified diff patch to the repository. Use only after reading the relevant files.",
  annotations: {
    title: "Apply patch",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  argsSchema: ApplyPatchArgsSchema,
  handler: applyPatch,
};

// ---------------------------------------------------------------------------
// Run tests
// ---------------------------------------------------------------------------

const runTests = async (
  args: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> => {
  const command = String(args.command);
  const repoRoot = String(args._repoRoot);
  const parts = command.trim().split(/\s+/);
  const denied = validateTestCommand({ parts, command });
  if (denied) return denied;
  const outcome = await runProcess(parts, repoRoot, { timeoutMs: 120_000 });
  return toolResultFromTests(outcome);
};

const validateTestCommand = (input: {
  parts: string[];
  command: string;
}): {
  ok: false;
  output: string;
} | null => {
  if (input.parts.length === 0) return { ok: false, output: "Empty command." };
  if (!isAllowedTestCommand(input.parts)) {
    return {
      ok: false,
      output: `Command not allowlisted: ${input.command}\nAllowed: npm test, pnpm test, pytest, go test ./..., cargo test, make test`,
    };
  }
  return null;
};

const toolResultFromTests = (outcome: ProcessOutcome): { ok: boolean; output: string } => {
  const combined = `${outcome.stdout}\n${outcome.stderr}`;
  return { ok: outcome.code === 0, output: trimOutput(combined.trim()) };
};

const runTestsTool: ToolDef = {
  name: "run_tests",
  description: "Run an allowed project test command (npm test, pytest, go test, etc.).",
  annotations: {
    title: "Run tests",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  argsSchema: RunTestsArgsSchema,
  handler: runTests,
};

const gitDiff = async (args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> => {
  const repoRoot = String(args._repoRoot);
  const [stat, diff] = await Promise.all([
    runProcess(["git", "diff", "--stat"], repoRoot, { timeoutMs: 10_000 }),
    runProcess(["git", "diff"], repoRoot, { timeoutMs: 20_000 }),
  ]);
  const combined = `--- stat ---\n${stat.stdout}\n\n--- diff ---\n${diff.stdout}`;
  return { ok: true, output: trimOutput(combined) };
};

const gitDiffTool: ToolDef = {
  name: "git_diff",
  description: "Show the current git diff and diff stat for the working tree.",
  annotations: { title: "Show git diff", readOnlyHint: true, openWorldHint: false },
  argsSchema: GitDiffArgsSchema,
  handler: gitDiff,
};

const jsonToolResult = (value: unknown): ToolResult => {
  return { ok: true, output: JSON.stringify(value) };
};

const optionalString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  if (value.length === 0) return undefined;
  return value;
};

const hasCallableUrl = (value: { url?: unknown }): boolean => {
  return value.url instanceof Function;
};

const optionalPage = (value: unknown): Page | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  if (!hasCallableUrl(value as { url?: unknown })) return undefined;
  return value as Page;
};

const conversationIdFromArgs = (args: Record<string, unknown>): string => {
  if (typeof args.conversationId === "string" && args.conversationId.length > 0) {
    return args.conversationId;
  }
  const page = optionalPage(args._page);
  if (page === undefined) throw new Error("No active ChatGPT browser page is available.");
  const fromUrl = chatGptConversationIdFromUrl(page.url());
  if (fromUrl === null) return "current";
  return fromUrl;
};

const pageFromArgs = (args: Record<string, unknown>): Page => {
  const page = optionalPage(args._page);
  if (page === undefined) throw new Error("No active ChatGPT browser page is available.");
  return page;
};

const attachmentIdsFromArgs = (args: Record<string, unknown>): string[] | undefined => {
  if (!Array.isArray(args.ids)) return undefined;
  return args.ids.filter((id): id is string => typeof id === "string");
};

export const listAttachmentsTool: ToolDef = {
  name: "chatgpt_list_attachments",
  description:
    "List captured attachments in a ChatGPT conversation, including their assistant/user role.",
  annotations: { title: "List ChatGPT attachments", readOnlyHint: true, openWorldHint: false },
  argsSchema: ListAttachmentsArgsSchema,
  handler: async (args) => {
    const repoRoot = String(args._repoRoot);
    const manifest = await loadManifest(conversationIdFromArgs(args), {
      manifestRoot: downloadsDir(repoRoot),
    });
    return jsonToolResult(manifest.attachments);
  },
};

export const downloadAttachmentTool: ToolDef = {
  name: "chatgpt_download_attachment",
  description: "Download one captured attachment from the active ChatGPT conversation.",
  annotations: {
    title: "Download ChatGPT attachment",
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  argsSchema: DownloadAttachmentArgsSchema,
  handler: async (args) => {
    const outDir = optionalString(args.outDir);
    const repoRoot = String(args._repoRoot);
    const downloaded = await downloadAttachment(
      pageFromArgs(args),
      conversationIdFromArgs(args),
      String(args.id),
      {
        repoRoot,
        manifestRoot: downloadsDir(repoRoot),
        ...(outDir === undefined ? {} : { outDir }),
      },
    );
    return jsonToolResult(downloaded);
  },
};

export const downloadAllAttachmentsTool: ToolDef = {
  name: "chatgpt_download_all",
  description:
    "Download all or selected captured attachments from the active ChatGPT conversation.",
  annotations: {
    title: "Download all ChatGPT attachments",
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  argsSchema: DownloadAllAttachmentsArgsSchema,
  handler: async (args) => {
    const outDir = optionalString(args.outDir);
    const repoRoot = String(args._repoRoot);
    const ids = attachmentIdsFromArgs(args);
    const downloaded = await downloadAll(pageFromArgs(args), conversationIdFromArgs(args), {
      repoRoot,
      manifestRoot: downloadsDir(repoRoot),
      ...(outDir === undefined ? {} : { outDir }),
      ...(ids === undefined ? {} : { ids }),
    });
    return jsonToolResult(downloaded);
  },
};

export const toolRegistry: Map<string, ToolDef> = new Map();

for (const tool of [
  grepTool,
  readFileToolDef,
  applyPatchTool,
  runTestsTool,
  gitDiffTool,
  listAttachmentsTool,
  downloadAttachmentTool,
  downloadAllAttachmentsTool,
]) {
  toolRegistry.set(tool.name, tool);
}

const toolActionStatus = (toolResult: ToolResult, blocked: boolean): McpToolAction["status"] => {
  if (blocked) return "blocked";
  if (toolResult.ok) return "completed";
  return "failed";
};

const sanitizeToolArgs = (args: Record<string, unknown>): Record<string, unknown> => {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (key === "_repoRoot") continue;
    clean[key] = value;
  }
  return clean;
};

const hooksForOptions = (options: McpServerOptions): readonly HookDefinition[] => {
  if (options.hooks === undefined) return [];
  return options.hooks;
};

const permissionModeForOptions = (options: McpServerOptions): PermissionMode => {
  if (options.getPermissionMode === undefined) return DEFAULT_PERMISSION_MODE;
  return options.getPermissionMode();
};

const handleToolCall = async (input: {
  repoRoot: string;
  options: McpServerOptions;
  name: string;
  tool: { handler: (args: Record<string, unknown>) => Promise<ToolResult> };
  args: Record<string, unknown>;
}) => {
  const hooks = hooksForOptions(input.options);
  await runHooks("PreToolUse", hooks).catch(() => []);
  const toolResult = await executeToolCall(input);
  await runHooks("PostToolUse", hooks).catch(() => []);
  return {
    content: [{ type: "text" as const, text: toolResult.output }],
    isError: !toolResult.ok,
  };
};

const executeToolCall = async (input: {
  repoRoot: string;
  options: McpServerOptions;
  name: string;
  tool: { handler: (args: Record<string, unknown>) => Promise<ToolResult> };
  args: Record<string, unknown>;
}): Promise<ToolResult> => {
  await logToolCallStart(input);
  const denied = permissionDecisionToToolResult(
    evaluateToolPermission(input.name, permissionModeForOptions(input.options)),
  );
  const toolResult = await invokeToolHandler({ ...input, denied });
  await logToolCallEnd({ params: input, toolResult, blocked: denied !== undefined });
  return toolResult;
};

const invokeToolHandler = async (input: {
  repoRoot: string;
  options: McpServerOptions;
  name: string;
  tool: { handler: (args: Record<string, unknown>) => Promise<ToolResult> };
  args: Record<string, unknown>;
  denied?: ToolResult;
}): Promise<ToolResult> => {
  if (input.denied !== undefined) return input.denied;
  try {
    const page = input.options.getPage === undefined ? undefined : input.options.getPage();
    if (page === undefined || page === null) {
      return await input.tool.handler({
        ...input.args,
        _repoRoot: input.repoRoot,
      });
    }
    return await input.tool.handler({
      ...input.args,
      _repoRoot: input.repoRoot,
      _page: page,
    });
  } catch (error) {
    return {
      ok: false,
      output: error instanceof Error ? error.message : String(error),
      error: "tool-handler-error",
    };
  }
};

const logToolCallStart = async (input: {
  repoRoot: string;
  options: McpServerOptions;
  name: string;
  args: Record<string, unknown>;
}): Promise<void> => {
  const cleanArgs = sanitizeToolArgs(input.args);
  await appendBridgeLog({
    repoPath: input.repoRoot,
    type: "mcp_tool_call",
    data: { name: input.name, args: cleanArgs },
  }).catch(() => {});
  if (input.options.onToolAction === undefined) return;
  await input.options.onToolAction({
    name: input.name,
    status: "started",
    data: { args: cleanArgs },
  });
};

const logToolCallEnd = async (input: {
  params: { repoRoot: string; options: McpServerOptions; name: string };
  toolResult: ToolResult;
  blocked: boolean;
}): Promise<void> => {
  await appendBridgeLog({
    repoPath: input.params.repoRoot,
    type: "mcp_tool_result",
    data: {
      name: input.params.name,
      ok: input.toolResult.ok,
      outputBytes: input.toolResult.output.length,
      error: input.toolResult.error,
    },
  }).catch(() => {});
  if (input.params.options.onToolAction === undefined) return;
  await input.params.options.onToolAction({
    name: input.params.name,
    status: toolActionStatus(input.toolResult, input.blocked),
    data: {
      ok: input.toolResult.ok,
      error: input.toolResult.error,
      outputBytes: input.toolResult.output.length,
    },
  });
};

const createMcpProtocolServer = (repoRoot: string, options: McpServerOptions): McpServer => {
  const mcp = new McpServer({ name: "ai-browser-bridge", version: "0.1.0" });
  for (const [name, tool] of toolRegistry) {
    mcp.registerTool(
      name,
      {
        description: tool.description,
        inputSchema: effectSchemaToMcpShape(tool.argsSchema),
        ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
      },
      async (args: Record<string, unknown>) => {
        return handleToolCall({ repoRoot, options, name, tool, args });
      },
    );
  }
  return mcp;
};

export const isSseEndpointPath = (pathname: string): boolean => {
  return pathname === "/" || pathname === "/sse" || pathname === "/sse/";
};

export const isStreamableHttpEndpointPath = (pathname: string): boolean => {
  return pathname === "/mcp" || pathname === "/mcp/";
};

const requestPathname = (url: string | undefined): string => {
  const requestUrl = url === undefined ? "/" : url;
  try {
    return new URL(requestUrl, "http://localhost").pathname;
  } catch {
    return "/";
  }
};

const requestHeader = (value: string | string[] | undefined): string | undefined => {
  if (Array.isArray(value)) return value[0];
  return value;
};

const readJsonBody = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : undefined;
};

const writeJsonRpcError = (res: ServerResponse, status: number, message: string): void => {
  res.writeHead(status, { "Content-Type": "application/json" }).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message },
      id: null,
    }),
  );
};

const writeSseProxyFlushPadding = (res: ServerResponse): void => {
  if (res.writableEnded) return;
  res.write(`: ${" ".repeat(2048)}\n\n`);
};

/** MCP HTTP server with SSE and streamable HTTP transports and sandboxed repo tools. */
export class McpHttpServer {
  private readonly repoRoot: string;
  private readonly options: McpServerOptions;
  private httpServer: ReturnType<typeof createServer> | null = null;
  private readonly connections = new Map<string, McpConnection>();
  private readonly streamableConnections = new Map<string, StreamableMcpConnection>();

  constructor(repoRoot: string, options: McpServerOptions = {}) {
    this.repoRoot = repoRoot;
    this.options = options;
  }

  async start(port: number): Promise<string> {
    this.httpServer = createServer((req, res) => {
      void this.handleRequest(req, res);
    });
    await this.listenOnPort(port);
    return `http://localhost:${port}`;
  }

  stop(): void {
    this.closeAllConnections(this.connections);
    this.closeAllConnections(this.streamableConnections);
    if (this.httpServer !== null) this.httpServer.close();
    this.httpServer = null;
  }

  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const pathname = requestPathname(req.url);
    if (isStreamableHttpEndpointPath(pathname)) {
      await this.handleStreamableHttpRequest(req, res);
      return;
    }
    if (isSseEndpointPath(pathname)) {
      await this.handleSseRequest(res);
      return;
    }
    if (pathname === "/messages" && req.method === "POST") {
      await this.handleSsePostMessage(req, res);
      return;
    }
    res.writeHead(404).end("Not found");
  }

  listTools(): ToolDef[] {
    return [...toolRegistry.values()];
  }

  private async listenOnPort(port: number): Promise<void> {
    const server = this.httpServer;
    if (server === null) throw new Error("HTTP server not initialized");
    const listenError = await new Promise<Error | undefined>((done) => {
      const onError = (err: Error) => done(err);
      server.once("error", onError);
      server.listen(port, () => {
        server.off("error", onError);
        done(undefined);
      });
    });
    if (listenError !== undefined) throw listenError;
  }

  private closeAllConnections(
    connections: Map<string, McpConnection | StreamableMcpConnection>,
  ): void {
    for (const connection of connections.values()) connection.server.close().catch(() => {});
    connections.clear();
  }

  private async handleSseRequest(res: ServerResponse): Promise<void> {
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

  private async handleSsePostMessage(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestUrl = req.url === undefined ? "/" : req.url;
    const sessionId = new URL(requestUrl, "http://localhost").searchParams.get("sessionId");
    if (sessionId === null) {
      res.writeHead(503).end("No active SSE connection");
      return;
    }
    const connection = this.connections.get(sessionId);
    if (connection === undefined) {
      res.writeHead(503).end("No active SSE connection");
      return;
    }
    await connection.transport.handlePostMessage(req, res);
  }

  private async handleStreamableHttpRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const sessionId = requestHeader(req.headers["mcp-session-id"]);
    let connection =
      sessionId === undefined ? undefined : this.streamableConnections.get(sessionId);
    let parsedBody: unknown;
    if (connection === undefined) {
      const created = await this.createStreamableConnection(req, res);
      if (created === null) return;
      connection = created.connection;
      parsedBody = created.parsedBody;
    }
    try {
      await connection.transport.handleRequest(req, res, parsedBody);
    } catch (error) {
      if (!res.headersSent) {
        writeJsonRpcError(
          res,
          500,
          error instanceof Error ? error.message : "Internal server error",
        );
      }
    }
  }

  private async createStreamableConnection(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<{ connection: StreamableMcpConnection; parsedBody: unknown } | null> {
    const sessionId = requestHeader(req.headers["mcp-session-id"]);
    if (sessionId !== undefined) {
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

  private async openStreamableConnection(): Promise<StreamableMcpConnection> {
    let createdConnection: StreamableMcpConnection | null = null;
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        if (createdConnection !== null) {
          this.streamableConnections.set(newSessionId, createdConnection);
        }
      },
    });
    createdConnection = { server: createMcpProtocolServer(this.repoRoot, this.options), transport };
    transport.onclose = () => {
      const closedSessionId = transport.sessionId;
      if (closedSessionId !== undefined) this.streamableConnections.delete(closedSessionId);
    };
    await createdConnection.server.connect(transport);
    return createdConnection;
  }
}

export const startMcpServer = (
  repoRoot: string,
  port: number,
  options: McpServerOptions = {},
): Promise<McpServerHandle> => {
  const server = new McpHttpServer(repoRoot, options);
  return server.start(port).then((url) => ({ url, close: () => server.stop() }));
};
