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
import type { ToolReport } from "@/domain/message-types.ts";
import {
  convertPermissionDecisionToToolReport,
  evaluateToolPermission,
  type PermissionMode,
} from "@/domain/permissions.ts";
import type { ToolDef } from "@/domain/tool-types.ts";
import { readChatGptConversationIdFromUrl } from "@/providers/chatgpt/chatgpt-conversation-url.ts";
import { downloadAll, downloadAttachment, loadManifest } from "@/providers/chatgpt/chatgpt-page.ts";
import { createCheckpoint } from "@/store/checkpoints.ts";
import { appendBridgeLog } from "@/store/logging.ts";
import { readDownloadsDirectory, readRepositoryPath } from "@/store/paths.ts";
import { type HookDefinition, runHooks } from "@/user-config/hooks.ts";
import {
  ApplyPatchArgumentListSchema,
  DownloadAllAttachmentsArgumentListSchema,
  DownloadAttachmentArgumentListSchema,
  GitDiffArgumentListSchema,
  GrepCodeArgumentListSchema,
  ListAttachmentsArgumentListSchema,
  ReadFileArgumentListSchema,
  RunTestsArgumentListSchema,
} from "./tools-schemas.ts";

const APPLY_PATCH_TOOL_NAME = "apply_patch";

const HTTP_POST_METHOD = "POST";

const GLOB_ARGUMENT_FLAG = "--glob";

const HTTP_BAD_REQUEST_STATUS = 400;

const HTTP_SERVICE_UNAVAILABLE_STATUS = 503;

const HTTP_INTERNAL_SERVER_ERROR_STATUS = 500;

const HTTP_NOT_FOUND_STATUS = 404;

const MESSAGES_PATH = "/messages";

const LOCALHOST_BASE_URL = "http://localhost";

const EMPTY_COMMAND_MESSAGE = "Empty command.";

const NO_ACTIVE_SSE_CONNECTION_MESSAGE = "No active SSE connection";

const NO_ACTIVE_CHATGPT_PAGE_MESSAGE = "No active ChatGPT browser page is available.";

const NO_VALID_SESSION_ID_MESSAGE = "Bad Request: No valid session ID provided";

const UTF8_ENCODING = "utf-8";
const PROCESS_TIMEOUT_MS = 20_000;

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

export type McpServerSettings = {
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

interface StreamableRequestTarget {
  connection: StreamableMcpConnection;
  parsedRequest: unknown;
}

export const isAllowedTestCommand = (parts: string[]): boolean => {
  return ALLOWED_TEST_PREFIXES.some(
    (prefix) => parts.slice(0, prefix.length).join(" ") === prefix.join(" "),
  );
};

const defaultPrintoutLimit = 20_000;

export const trimPrintout = (printout: string, limit = defaultPrintoutLimit): string => {
  const isLengthAtMostLimit = printout.length <= limit;
  if (isLengthAtMostLimit) return printout;

  return `${printout.slice(0, limit)}\n\n[trimmed: output exceeded ${limit} chars]`;
};

type ProcessExit = {
  stdout: string;
  stderr: string;
  code: number | null;
};

type RunProcessSettings = {
  timeoutMs?: number;
  stdin?: string;
};

type SpawnProcessDetails = {
  command: string;
  args: string[];
  cwd: string;
  stdin?: string;
  timeoutMs: number;
};

const runProcess = (
  argumentList: readonly string[],
  cwd: string,
  settings: RunProcessSettings = {},
): Promise<ProcessExit> => {
  const hasNoArgumentList = argumentList.length === 0;
  if (hasNoArgumentList)
    return Promise.resolve({ stdout: "", stderr: EMPTY_COMMAND_MESSAGE, code: 1 });

  const [command = "", ...rest] = argumentList;
  const defaultTimeoutMilliseconds = 30_000;

  const configuredTimeoutMs = settings.timeoutMs;
  const isTimeoutMsMissing = configuredTimeoutMs == null;
  const timeoutMs = isTimeoutMsMissing ? defaultTimeoutMilliseconds : configuredTimeoutMs;
  return spawnProcess({
    command,
    args: rest,
    cwd,
    stdin: settings.stdin,
    timeoutMs,
  });
};

const spawnProcess = (details: SpawnProcessDetails): Promise<ProcessExit> => {
  return new Promise((finish) => {
    const proc = spawn(details.command, details.args, { cwd: details.cwd });
    attachProcessListeners({ proc, timeoutMs: details.timeoutMs, finish });
    writeProcessStdin({ proc, stdin: details.stdin });
  });
};

const attachProcessListeners = (details: {
  proc: ChildProcess;
  timeoutMs: number;
  finish: (verdict: ProcessExit) => void;
}): void => {
  const processPrintouts = { stdout: "", stderr: "" };
  const timer = setTimeout(() => {
    details.proc.kill();
  }, details.timeoutMs);

  attachProcessPrintout({ proc: details.proc, output: processPrintouts });
  attachProcessCompletion({
    proc: details.proc,
    timer,
    output: processPrintouts,
    finish: details.finish,
  });
};

const attachProcessPrintout = (details: {
  proc: ChildProcess;
  output: { stdout: string; stderr: string };
}): void => {
  details.proc.stdout?.on("data", (chunk: Buffer) => {
    details.output.stdout += chunk.toString();
  });

  details.proc.stderr?.on("data", (chunk: Buffer) => {
    details.output.stderr += chunk.toString();
  });
};

const attachProcessCompletion = (details: {
  proc: ChildProcess;
  timer: NodeJS.Timeout;
  output: { stdout: string; stderr: string };
  finish: (verdict: ProcessExit) => void;
}): void => {
  details.proc.on("close", (code) => {
    clearTimeout(details.timer);
    details.finish({ stdout: details.output.stdout, stderr: details.output.stderr, code });
  });

  details.proc.on("error", (error) => {
    clearTimeout(details.timer);
    details.finish({ stdout: details.output.stdout, stderr: error.message, code: 1 });
  });
};

const writeProcessStdin = (details: { proc: ChildProcess; stdin?: string }): void => {
  const isDetailsStdinMissing = details.stdin == null;
  if (isDetailsStdinMissing) return;

  details.proc.stdin?.write(details.stdin);
  details.proc.stdin?.end();
};

type ReadFileSliceDetails = {
  safePath: string;
  path: string;
  startLine: number;
  maxLines: number;
};

const readNumberedSlice = async (
  details: ReadFileSliceDetails,
): Promise<{ ok: true; output: string }> => {
  const unparsed = await readFile(details.safePath, UTF8_ENCODING);
  const lines = unparsed.split("\n");
  const start = Math.max(details.startLine - 1, 0);
  const end = Math.min(start + details.maxLines, lines.length);
  const numberedSlice = createNumberedSlice({ lines, start, end, path: details.path });

  return {
    ok: true,
    output: trimPrintout(numberedSlice),
  };
};

const createNumberedSlice = (details: {
  lines: string[];
  start: number;
  end: number;
  path: string;
}): string => {
  const header = `path: ${details.path}\nlines: ${details.start + 1}-${details.end} of ${details.lines.length}\n`;
  return (
    header + writeNumberedLines({ lines: details.lines, start: details.start, end: details.end })
  );
};

const writeNumberedLines = (details: { lines: string[]; start: number; end: number }): string => {
  let numberedPrintout = "";

  for (let index = details.start; index < details.end; index += 1) {
    numberedPrintout += `${index + 1}: ${details.lines[index]}\n`;
  }

  const isEndingInNewline = numberedPrintout.endsWith("\n");

  return isEndingInNewline ? numberedPrintout.slice(0, -1) : numberedPrintout;
};

const readFileTool = async (
  argumentList: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> => {
  const details = readFileToolArguments(argumentList);

  const invalid = await assertReadableFile({ safePath: details.safePath, path: details.path });

  const isFileInvalid = invalid != null;
  if (isFileInvalid) return invalid;

  return await readNumberedSlice(details);
};

const readFileToolArguments = (argumentList: Record<string, unknown>): ReadFileSliceDetails => {
  const path = String(argumentList.path);
  const repoRoot = String(argumentList._repoRoot);
  const isStartLineMissing = argumentList.start_line === undefined;
  const startLine = isStartLineMissing ? 1 : Number(argumentList.start_line);
  const isMaxLinesMissing = argumentList.max_lines === undefined;
  const defaultMaxLines = 200;

  const maxLines = isMaxLinesMissing ? defaultMaxLines : Number(argumentList.max_lines);

  return {
    path,
    safePath: readRepositoryPath(repoRoot, path),
    startLine,
    maxLines,
  };
};

const assertReadableFile = async (details: {
  safePath: string;
  path: string;
}): Promise<{
  ok: false;
  output: string;
} | null> => {
  try {
    const fileStat = await stat(details.safePath);

    const isNotFileFileStat = !fileStat.isFile();
    if (isNotFileFileStat) return { ok: false, output: `Not a file: ${details.path}` };
  } catch {
    return { ok: false, output: `File not found: ${details.path}` };
  }
  return null;
};

const readFileToolDef: ToolDef = {
  name: "read_file",
  description: "Read a repo file with line numbers. Use after grep_code before proposing edits.",
  annotations: { title: "Read file", readOnlyHint: true, openWorldHint: false },
  argsSchema: ReadFileArgumentListSchema,
  handler: readFileTool,
};

type RgArgumentListDetails = {
  pattern: string;
  safePath: string;
  glob: string | null;
};

const listRipgrepArgumentList = (details: RgArgumentListDetails): string[] => {
  const argumentList = [
    "rg",
    "--line-number",
    "--hidden",
    GLOB_ARGUMENT_FLAG,
    "!.git",
    GLOB_ARGUMENT_FLAG,
    "!node_modules",
    GLOB_ARGUMENT_FLAG,
    "!dist",
    GLOB_ARGUMENT_FLAG,
    "!build",
  ];

  const detailsGlob = details.glob;
  const hasDetailsGlob = detailsGlob != null;
  if (hasDetailsGlob) argumentList.push(GLOB_ARGUMENT_FLAG, detailsGlob);

  argumentList.push(details.pattern, details.safePath);
  return argumentList;
};

const createToolReportFromGrep = (verdict: ProcessExit): { ok: boolean; output: string } => {
  const isGrepFoundNothing = verdict.code === 1;
  if (isGrepFoundNothing) return { ok: true, output: "" };

  const isGrepFailed = verdict.code !== 0;
  if (isGrepFailed) return { ok: false, output: verdict.stderr };

  return { ok: true, output: trimPrintout(verdict.stdout) };
};

const readGrepCode = async (
  argumentList: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> => {
  const details = readGrepArguments(argumentList);
  const ripgrepArgumentList = listRipgrepArgumentList(details);
  const ripgrepProcess = await runProcess(ripgrepArgumentList, details.repoRoot, {
    timeoutMs: PROCESS_TIMEOUT_MS,
  });

  return createToolReportFromGrep(ripgrepProcess);
};

const readGrepArguments = (
  argumentList: Record<string, unknown>,
): RgArgumentListDetails & { repoRoot: string } => {
  const repoRoot = String(argumentList._repoRoot);
  const isGlobGiven = argumentList.glob != null;
  const glob = isGlobGiven ? String(argumentList.glob) : null;
  const pathText = String(argumentList.path);
  const safePath = readRepositoryPath(repoRoot, pathText);

  return {
    pattern: String(argumentList.pattern),
    safePath,
    glob,
    repoRoot,
  };
};

const grepTool: ToolDef = {
  name: "grep_code",
  description:
    "Search the repository using ripgrep. Locate symbols, imports, routes, tests, configs, and references.",
  annotations: { title: "Search repo", readOnlyHint: true, openWorldHint: false },
  argsSchema: GrepCodeArgumentListSchema,
  handler: readGrepCode,
};

type ApplyPatchDetails = {
  patch: string;
  repoRoot: string;
  patchPaths: string[];
};

const runGitApply = async (
  details: ApplyPatchDetails,
): Promise<{ ok: boolean; output: string }> => {
  const check = await runProcess(["git", "apply", "--check", "-"], details.repoRoot, {
    stdin: details.patch,
    timeoutMs: PROCESS_TIMEOUT_MS,
  });
  const isCheckFailed = check.code !== 0;
  if (isCheckFailed) {
    const checkFailure = readFailureMessage(check);
    return {
      ok: false,
      output: `Patch check failed:\n${trimPrintout(checkFailure)}`,
    };
  }

  const applied = await runProcess(["git", "apply", "-"], details.repoRoot, {
    stdin: details.patch,
    timeoutMs: PROCESS_TIMEOUT_MS,
  });
  const isApplyFailed = applied.code !== 0;
  if (isApplyFailed) {
    const appliedFailure = readFailureMessage(applied);
    return {
      ok: false,
      output: `Patch apply failed:\n${trimPrintout(appliedFailure)}`,
    };
  }

  return { ok: true, output: "Patch applied successfully." };
};

const readFailureMessage = (verdict: ProcessExit): string => {
  const isStderrNotEmpty = verdict.stderr.length > 0;
  if (isStderrNotEmpty) return verdict.stderr;

  return verdict.stdout;
};

const createPatchCheckpointNote = async (details: ApplyPatchDetails): Promise<string> => {
  const isPatchPathsEmpty = details.patchPaths.length === 0;
  if (isPatchPathsEmpty) return "";

  const before = await createCheckpoint({
    repoRoot: details.repoRoot,
    paths: details.patchPaths,
    phase: "before",
    label: APPLY_PATCH_TOOL_NAME,
  });
  const after = await createCheckpoint({
    repoRoot: details.repoRoot,
    paths: details.patchPaths,
    phase: "after",
    label: APPLY_PATCH_TOOL_NAME,
  });
  return `\nCheckpoints:\n- before: ${before.id}\n- after: ${after.id}`;
};

const applyPatch = async (
  argumentList: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> => {
  const details = readApplyPatchArguments(argumentList);
  readRepositoryPath(details.repoRoot, ".");
  const patchPaths = extractPatchPaths(details.patch);

  const applied = await runGitApply({
    patch: details.patch,
    repoRoot: details.repoRoot,
    patchPaths,
  });

  const isApplyFailed = !applied.ok;
  if (isApplyFailed) return applied;

  const checkpointNote = await createPatchCheckpointNote({
    patch: details.patch,
    repoRoot: details.repoRoot,
    patchPaths,
  });
  return { ok: true, output: applied.output + checkpointNote };
};

const readApplyPatchArguments = (
  argumentList: Record<string, unknown>,
): { patch: string; repoRoot: string } => {
  return { patch: String(argumentList.patch), repoRoot: String(argumentList._repoRoot) };
};

const GIT_DIFF_HEADER = /^diff --git a\/(?<oldPath>.+?) b\/(?<newPath>.+)$/;
const GIT_FILE_MARKER = /^(?:---|\+\+\+) (?:a|b)\/(?<filePath>.+)$/;

export const extractPatchPaths = (patch: string): string[] => {
  const paths = new Set<string>();
  for (const line of patch.split(/\r?\n/)) {
    const gitHeaderParts = GIT_DIFF_HEADER.exec(line);
    const gitPaths = gitHeaderParts?.groups;

    const hasGitPaths = gitPaths != null;
    if (hasGitPaths) {
      const oldPath = gitPaths.oldPath;
      const hasGitPathsOldPath = oldPath != null;
      if (hasGitPathsOldPath) addPatchPath({ paths, path: oldPath });

      const newPath = gitPaths.newPath;
      const hasGitPathsNewPath = newPath != null;
      if (hasGitPathsNewPath) addPatchPath({ paths, path: newPath });

      continue;
    }

    const filePath = GIT_FILE_MARKER.exec(line)?.groups?.filePath;

    const hasFilePath = filePath != null;
    if (hasFilePath) addPatchPath({ paths, path: filePath });
  }
  return [...paths];
};

const addPatchPath = (details: { paths: Set<string>; path: string }): void => {
  const trimmed = details.path.trim();

  const isNoRealPath = trimmed.length === 0 || trimmed === "/dev/null";
  if (isNoRealPath) return;

  details.paths.add(trimmed);
};

const applyPatchTool: ToolDef = {
  name: APPLY_PATCH_TOOL_NAME,
  description:
    "Apply a unified diff patch to the repository. Use only after reading the relevant files.",
  annotations: {
    title: "Apply patch",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  argsSchema: ApplyPatchArgumentListSchema,
  handler: applyPatch,
};

const runTests = async (
  argumentList: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> => {
  const command = String(argumentList.command);
  const repoRoot = String(argumentList._repoRoot);
  const parts = command.trim().split(/\s+/);

  const denied = validateTestCommand({ parts, command });

  const isCommandDenied = denied != null;
  if (isCommandDenied) return denied;

  const checkTimeoutMilliseconds = 120_000;

  const verdict = await runProcess(parts, repoRoot, { timeoutMs: checkTimeoutMilliseconds });
  return createToolReportFromTests(verdict);
};

const validateTestCommand = (details: {
  parts: string[];
  command: string;
}): {
  ok: false;
  output: string;
} | null => {
  const isPartsEmpty = details.parts.length === 0;
  if (isPartsEmpty) return { ok: false, output: EMPTY_COMMAND_MESSAGE };

  const isNotAllowedTestCommandParts = !isAllowedTestCommand(details.parts);
  if (isNotAllowedTestCommandParts) {
    return {
      ok: false,
      output: `Command not allowlisted: ${details.command}\nAllowed: npm test, pnpm test, pytest, go test ./..., cargo test, make test`,
    };
  }

  return null;
};

const createToolReportFromTests = (verdict: ProcessExit): { ok: boolean; output: string } => {
  const combined = `${verdict.stdout}\n${verdict.stderr}`;
  const trimmedCombined = combined.trim();
  return { ok: verdict.code === 0, output: trimPrintout(trimmedCombined) };
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
  argsSchema: RunTestsArgumentListSchema,
  handler: runTests,
};

const readGitDiff = async (
  argumentList: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> => {
  const repoRoot = String(argumentList._repoRoot);
  const gitDiffTimeoutMilliseconds = 20_000;

  const gitDiffStatTimeoutMilliseconds = 10_000;

  const [stat, diff] = await Promise.all([
    runProcess(["git", "diff", "--stat"], repoRoot, { timeoutMs: gitDiffStatTimeoutMilliseconds }),
    runProcess(["git", "diff"], repoRoot, { timeoutMs: gitDiffTimeoutMilliseconds }),
  ]);
  const combined = `--- stat ---\n${stat.stdout}\n\n--- diff ---\n${diff.stdout}`;

  return { ok: true, output: trimPrintout(combined) };
};

const gitDiffTool: ToolDef = {
  name: "git_diff",
  description: "Show the current git diff and diff stat for the working tree.",
  annotations: { title: "Show git diff", readOnlyHint: true, openWorldHint: false },
  argsSchema: GitDiffArgumentListSchema,
  handler: readGitDiff,
};

const createDocumentToolReport = (field: unknown): ToolReport => {
  return { ok: true, output: JSON.stringify(field) };
};

const readOptionalString = (field: unknown): string | null => {
  const isTypeNotString = typeof field !== "string";
  if (isTypeNotString) return null;

  const isArgumentEmpty = field.length === 0;
  if (isArgumentEmpty) return null;

  return field;
};

const hasCallableUrl = (field: { url?: unknown }): boolean => {
  return field.url instanceof Function;
};

const readOptionalPage = (field: unknown): Page | null => {
  const isNotObjectLike = typeof field !== "object" || field === null;
  if (isNotObjectLike) return null;

  const isNotCallableUrl = !hasCallableUrl(field);
  if (isNotCallableUrl) return null;

  return field as Page;
};

const readConversationIdFromArgumentList = (argumentList: Record<string, unknown>): string => {
  const conversationId = argumentList.conversationId;
  const hasConversationId = typeof conversationId === "string" && conversationId.length > 0;
  if (hasConversationId) {
    return conversationId;
  }

  const page = readOptionalPage(argumentList._page);

  const isPageMissing = page == null;
  if (isPageMissing) throw new Error(NO_ACTIVE_CHATGPT_PAGE_MESSAGE);

  const pageUrl = page.url();
  const fromUrl = readChatGptConversationIdFromUrl(pageUrl);

  const isFromUrlMissing = fromUrl == null;
  if (isFromUrlMissing) return "current";

  return fromUrl;
};

const readPageFromArgumentList = (argumentList: Record<string, unknown>): Page => {
  const page = readOptionalPage(argumentList._page);

  const isPageMissing = page == null;
  if (isPageMissing) throw new Error(NO_ACTIVE_CHATGPT_PAGE_MESSAGE);

  return page;
};

const readAttachmentIdsFromArgumentList = (
  argumentList: Record<string, unknown>,
): string[] | null => {
  const ids = argumentList.ids;
  const isNotIdsArray = !Array.isArray(ids);
  if (isNotIdsArray) return null;

  return ids.filter((id): id is string => typeof id === "string");
};

export const listAttachmentsTool: ToolDef = {
  name: "chatgpt_list_attachments",
  description:
    "List captured attachments in a ChatGPT conversation, including their assistant/user role.",
  annotations: { title: "List ChatGPT attachments", readOnlyHint: true, openWorldHint: false },
  argsSchema: ListAttachmentsArgumentListSchema,
  handler: async (argumentList) => {
    const repoRoot = String(argumentList._repoRoot);
    const conversationId = readConversationIdFromArgumentList(argumentList);
    const downloadsDirectory = readDownloadsDirectory(repoRoot);
    const manifest = await loadManifest(conversationId, {
      manifestRoot: downloadsDirectory,
    });
    return createDocumentToolReport(manifest.attachments);
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
  argsSchema: DownloadAttachmentArgumentListSchema,
  handler: async (argumentList) => {
    const outDirectory = readOptionalString(argumentList.outDir);
    const repoRoot = String(argumentList._repoRoot);
    const isOutDirectoryMissing = outDirectory == null;
    const page = readPageFromArgumentList(argumentList);
    const conversationId = readConversationIdFromArgumentList(argumentList);
    const attachmentId = String(argumentList.id);
    const downloadsDirectory = readDownloadsDirectory(repoRoot);
    const downloaded = await downloadAttachment({
      page,
      conversationId,
      id: attachmentId,
      settings: {
        repoRoot,
        manifestRoot: downloadsDirectory,
        ...(isOutDirectoryMissing ? {} : { outDir: outDirectory }),
      },
    });

    return createDocumentToolReport(downloaded);
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
  argsSchema: DownloadAllAttachmentsArgumentListSchema,
  handler: async (argumentList) => {
    const outDirectory = readOptionalString(argumentList.outDir);
    const repoRoot = String(argumentList._repoRoot);
    const ids = readAttachmentIdsFromArgumentList(argumentList);
    const isOutDirectoryMissing = outDirectory == null;
    const isIdsMissing = ids == null;
    const page = readPageFromArgumentList(argumentList);
    const conversationId = readConversationIdFromArgumentList(argumentList);
    const downloadsDirectory = readDownloadsDirectory(repoRoot);
    const downloaded = await downloadAll(page, conversationId, {
      repoRoot,
      manifestRoot: downloadsDirectory,
      ...(isOutDirectoryMissing ? {} : { outDir: outDirectory }),
      ...(isIdsMissing ? {} : { ids }),
    });

    return createDocumentToolReport(downloaded);
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

const readToolActionStatus = (
  toolReport: ToolReport,
  blocked: boolean,
): McpToolAction["status"] => {
  if (blocked) return "blocked";

  const isToolReportOk = toolReport.ok;
  if (isToolReportOk) return "completed";

  return "failed";
};

const sanitizeToolArgumentList = (
  argumentList: Record<string, unknown>,
): Record<string, unknown> => {
  const publicArgumentList: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(argumentList)) {
    const isKeyRepoRoot = key === "_repoRoot";
    if (isKeyRepoRoot) continue;

    publicArgumentList[key] = field;
  }
  return publicArgumentList;
};

const listHooks = (settings: McpServerSettings): readonly HookDefinition[] => {
  const hooks = settings.hooks;
  const isSettingsHooksMissing = hooks == null;
  if (isSettingsHooksMissing) return [];

  return hooks;
};

const readPermissionMode = (settings: McpServerSettings): PermissionMode => {
  const currentPermissionMode = settings.getPermissionMode?.();
  const isPermissionModeMissing = currentPermissionMode == null;
  if (isPermissionModeMissing) return DEFAULT_PERMISSION_MODE;

  return currentPermissionMode;
};

const runToolCall = async (details: {
  repoRoot: string;
  options: McpServerSettings;
  name: string;
  tool: { handler: (argumentList: Record<string, unknown>) => Promise<ToolReport> };
  args: Record<string, unknown>;
}) => {
  const hooks = listHooks(details.options);

  await Promise.allSettled([runHooks("PreToolUse", hooks)]);

  const toolReport = await executeToolCall(details);

  await Promise.allSettled([runHooks("PostToolUse", hooks)]);

  return {
    content: [{ type: "text" as const, text: toolReport.output }],
    isError: !toolReport.ok,
  };
};

const executeToolCall = async (details: {
  repoRoot: string;
  options: McpServerSettings;
  name: string;
  tool: { handler: (argumentList: Record<string, unknown>) => Promise<ToolReport> };
  args: Record<string, unknown>;
}): Promise<ToolReport> => {
  await logToolCallStart(details);

  const permissionMode = readPermissionMode(details.options);
  const permissionDecision = evaluateToolPermission(details.name, permissionMode);
  const denied = convertPermissionDecisionToToolReport(permissionDecision);
  const toolReport = await invokeToolHandler({ ...details, denied });

  await logToolCallEnd({ params: details, toolResult: toolReport, blocked: denied != null });

  return toolReport;
};

const invokeToolHandler = async (details: {
  repoRoot: string;
  options: McpServerSettings;
  name: string;
  tool: { handler: (argumentList: Record<string, unknown>) => Promise<ToolReport> };
  args: Record<string, unknown>;
  denied: ToolReport | null;
}): Promise<ToolReport> => {
  const deniedReport = details.denied;
  const hasDetailsDenied = deniedReport != null;
  if (hasDetailsDenied) return deniedReport;

  try {
    return await callToolHandler(details);
  } catch (error) {
    const isErrorObject = error instanceof Error;
    return {
      ok: false,
      output: isErrorObject ? error.message : String(error),
      error: "tool-handler-error",
    };
  }
};

const callToolHandler = async (details: {
  repoRoot: string;
  options: McpServerSettings;
  tool: { handler: (argumentList: Record<string, unknown>) => Promise<ToolReport> };
  args: Record<string, unknown>;
}): Promise<ToolReport> => {
  const { getPage } = details.options;
  const isGetPageMissing = getPage == null;
  if (isGetPageMissing) {
    return await details.tool.handler({
      ...details.args,
      _repoRoot: details.repoRoot,
    });
  }

  const page = getPage();

  const isPageMissing = page == null;
  if (isPageMissing) {
    return await details.tool.handler({
      ...details.args,
      _repoRoot: details.repoRoot,
    });
  }

  return await details.tool.handler({
    ...details.args,
    _repoRoot: details.repoRoot,
    _page: page,
  });
};

const logToolCallStart = async (details: {
  repoRoot: string;
  options: McpServerSettings;
  name: string;
  args: Record<string, unknown>;
}): Promise<void> => {
  const publicArgumentList = sanitizeToolArgumentList(details.args);
  await Promise.allSettled([
    appendBridgeLog({
      repoPath: details.repoRoot,
      type: "mcp_tool_call",
      data: { name: details.name, args: publicArgumentList },
    }),
  ]);

  const { onToolAction } = details.options;
  const isToolActionMissing = onToolAction == null;
  if (isToolActionMissing) return;

  await onToolAction({
    name: details.name,
    status: "started",
    data: { args: publicArgumentList },
  });
};

const logToolCallEnd = async (details: {
  params: { repoRoot: string; options: McpServerSettings; name: string };
  toolResult: ToolReport;
  blocked: boolean;
}): Promise<void> => {
  await Promise.allSettled([
    appendBridgeLog({
      repoPath: details.params.repoRoot,
      type: "mcp_tool_result",
      data: {
        name: details.params.name,
        ok: details.toolResult.ok,
        outputBytes: details.toolResult.output.length,
        error: details.toolResult.error,
      },
    }),
  ]);

  const { onToolAction } = details.params.options;
  const isToolActionMissing = onToolAction == null;
  if (isToolActionMissing) return;

  const toolActionStatus = readToolActionStatus(details.toolResult, details.blocked);
  await onToolAction({
    name: details.params.name,
    status: toolActionStatus,
    data: {
      ok: details.toolResult.ok,
      error: details.toolResult.error,
      outputBytes: details.toolResult.output.length,
    },
  });
};

const createMcpProtocolServer = (repoRoot: string, settings: McpServerSettings): McpServer => {
  const mcp = new McpServer({ name: "ai-browser-bridge", version: "0.1.0" });

  for (const [name, tool] of toolRegistry) {
    const { annotations } = tool;
    const isAnnotationsMissing = annotations == null;
    const toolSettings = {
      description: tool.description,
      inputSchema: tool.argsSchema.shape,
      ...(isAnnotationsMissing ? {} : { annotations }),
    };
    mcp.registerTool(name, toolSettings, async (argumentList: Record<string, unknown>) => {
      return runToolCall({ repoRoot, options: settings, name, tool, args: argumentList });
    });
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
  const isUrlMissing = url == null;
  const requestUrl = isUrlMissing ? "/" : url;

  try {
    return new URL(requestUrl, LOCALHOST_BASE_URL).pathname;
  } catch {
    return "/";
  }
};

const requestHeader = (field: string | string[] | undefined): string | undefined => {
  const isHeaderList = Array.isArray(field);
  if (isHeaderList) return field[0];

  return field;
};

const readRequestDocument = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const isChunkBuffer = Buffer.isBuffer(chunk);
    if (isChunkBuffer) {
      chunks.push(chunk);
    } else {
      const chunkBuffer = Buffer.from(chunk);
      chunks.push(chunkBuffer);
    }
  }

  const requestDocument = Buffer.concat(chunks).toString(UTF8_ENCODING);

  const isRequestEmpty = requestDocument.length === 0;
  if (isRequestEmpty) return null;

  return JSON.parse(requestDocument);
};

const writeDocumentRpcError = (reply: ServerResponse, status: number, message: string): void => {
  const jsonRpcServerErrorCode = -32000;
  const errorBody = JSON.stringify({
    jsonrpc: "2.0",
    error: { code: jsonRpcServerErrorCode, message },
    id: null,
  });

  reply.writeHead(status, { "Content-Type": "application/json" }).end(errorBody);
};

const writeSseProxyFlushPadding = (reply: ServerResponse): void => {
  const isReplyEnded = reply.writableEnded;
  if (isReplyEnded) return;

  const ssePaddingBytes = 2048;

  reply.write(`: ${" ".repeat(ssePaddingBytes)}\n\n`);
};

class McpHttpServer {
  private readonly repoRoot: string;
  private readonly options: McpServerSettings;
  private httpServer: ReturnType<typeof createServer> | null = null;
  private readonly connections = new Map<string, McpConnection>();
  private readonly streamableConnections = new Map<string, StreamableMcpConnection>();

  constructor(repoRoot: string, settings: McpServerSettings = {}) {
    this.repoRoot = repoRoot;
    this.options = settings;
  }

  async start(port: number): Promise<string> {
    this.httpServer = createServer((request, reply) => {
      void this.runRequest(request, reply);
    });
    await this.listenOnPort(port);
    return `http://localhost:${port}`;
  }

  stop(): void {
    this.closeAllConnections(this.connections);
    this.closeAllConnections(this.streamableConnections);

    const runningHttpServer = this.httpServer;
    const isHttpServerRunning = runningHttpServer != null;
    if (isHttpServerRunning) runningHttpServer.close();

    this.httpServer = null;
  }

  async runRequest(request: IncomingMessage, reply: ServerResponse): Promise<void> {
    const pathname = requestPathname(request.url);
    if (isStreamableHttpEndpointPath(pathname)) {
      await this.runStreamableHttpRequest(request, reply);
      return;
    }

    if (isSseEndpointPath(pathname)) {
      await this.runSseRequest(reply);
      return;
    }

    const isSsePostMessage = pathname === MESSAGES_PATH && request.method === HTTP_POST_METHOD;
    if (isSsePostMessage) {
      await this.runSsePostMessage(request, reply);
      return;
    }

    reply.writeHead(HTTP_NOT_FOUND_STATUS).end("Not found");
  }

  listTools(): ToolDef[] {
    return [...toolRegistry.values()];
  }

  private async listenOnPort(port: number): Promise<void> {
    const server = this.httpServer;

    const isServerMissing = server == null;
    if (isServerMissing) throw new Error("HTTP server not initialized");

    const listenError = await new Promise<Error | null>((settle) => {
      const settleOnServerError = (error: Error) => settle(error);

      server.once("error", settleOnServerError);
      server.listen(port, () => {
        server.off("error", settleOnServerError);
        settle(null);
      });
    });

    const hasListenError = listenError != null;
    if (hasListenError) throw listenError;
  }

  private closeAllConnections(
    connections: Map<string, McpConnection | StreamableMcpConnection>,
  ): void {
    const closingServers = [...connections.values()].map((connection) => connection.server.close());
    void Promise.allSettled(closingServers);
    connections.clear();
  }

  private async runSseRequest(reply: ServerResponse): Promise<void> {
    const transport = new SSEServerTransport(MESSAGES_PATH, reply);
    const mcp = createMcpProtocolServer(this.repoRoot, this.options);
    this.connections.set(transport.sessionId, { server: mcp, transport });
    transport.onclose = () => this.connections.delete(transport.sessionId);
    try {
      await mcp.connect(transport);
      writeSseProxyFlushPadding(reply);
    } catch (error) {
      this.connections.delete(transport.sessionId);

      const isNotHeadersSent = !reply.headersSent;
      if (isNotHeadersSent) {
        const isErrorObject = error instanceof Error;
        reply
          .writeHead(HTTP_INTERNAL_SERVER_ERROR_STATUS)
          .end(isErrorObject ? error.message : String(error));
      }
    }
  }

  private async runSsePostMessage(request: IncomingMessage, reply: ServerResponse): Promise<void> {
    const requestUrl = request.url ?? "/";
    const sessionId = new URL(requestUrl, LOCALHOST_BASE_URL).searchParams.get("sessionId");

    const isSessionIdMissing = sessionId == null;
    if (isSessionIdMissing) {
      reply.writeHead(HTTP_SERVICE_UNAVAILABLE_STATUS).end(NO_ACTIVE_SSE_CONNECTION_MESSAGE);
      return;
    }

    const connection = this.connections.get(sessionId);

    const isConnectionMissing = connection == null;
    if (isConnectionMissing) {
      reply.writeHead(HTTP_SERVICE_UNAVAILABLE_STATUS).end(NO_ACTIVE_SSE_CONNECTION_MESSAGE);
      return;
    }

    await connection.transport.handlePostMessage(request, reply);
  }

  private async runStreamableHttpRequest(
    request: IncomingMessage,
    reply: ServerResponse,
  ): Promise<void> {
    const sessionId = requestHeader(request.headers["mcp-session-id"]);

    const hasSessionId = sessionId != null;
    const existingConnection = hasSessionId ? this.streamableConnections.get(sessionId) : undefined;

    const isConnectionMissing = existingConnection == null;
    if (isConnectionMissing) {
      const opened = await this.openStreamableInitialize(request, reply);

      const isOpenedMissing = opened == null;
      if (isOpenedMissing) return;

      await this.answerStreamableRequest(request, reply, opened);
      return;
    }

    await this.answerStreamableRequest(request, reply, {
      connection: existingConnection,
      parsedRequest: undefined,
    });
  }

  private async answerStreamableRequest(
    request: IncomingMessage,
    reply: ServerResponse,
    target: StreamableRequestTarget,
  ): Promise<void> {
    try {
      await target.connection.transport.handleRequest(request, reply, target.parsedRequest);
    } catch (error) {
      const isNotHeadersSent = !reply.headersSent;
      if (isNotHeadersSent) {
        const isErrorObject = error instanceof Error;
        writeDocumentRpcError(
          reply,
          HTTP_INTERNAL_SERVER_ERROR_STATUS,
          isErrorObject ? error.message : "Internal server error",
        );
      }
    }
  }

  private async openStreamableInitialize(
    request: IncomingMessage,
    reply: ServerResponse,
  ): Promise<StreamableRequestTarget | null> {
    const sessionId = requestHeader(request.headers["mcp-session-id"]);

    const hasSessionId = sessionId != null;
    if (hasSessionId) {
      writeDocumentRpcError(reply, HTTP_NOT_FOUND_STATUS, "Session not found");
      return null;
    }

    const isNotPostRequest = request.method !== HTTP_POST_METHOD;
    if (isNotPostRequest) {
      writeDocumentRpcError(reply, HTTP_BAD_REQUEST_STATUS, NO_VALID_SESSION_ID_MESSAGE);
      return null;
    }

    const parsedRequest = await readRequestDocument(request);

    const isNotInitializeRequest = !isInitializeRequest(parsedRequest);
    if (isNotInitializeRequest) {
      writeDocumentRpcError(reply, HTTP_BAD_REQUEST_STATUS, NO_VALID_SESSION_ID_MESSAGE);
      return null;
    }

    const connection = await this.openStreamableConnection();
    return { connection, parsedRequest };
  }

  private async openStreamableConnection(): Promise<StreamableMcpConnection> {
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        this.streamableConnections.set(newSessionId, streamableConnection);
      },
    });
    const streamableConnection: StreamableMcpConnection = {
      server: createMcpProtocolServer(this.repoRoot, this.options),
      transport,
    };
    transport.onclose = () => {
      const closedSessionId = transport.sessionId;

      const hasClosedSessionId = closedSessionId != null;
      if (hasClosedSessionId) this.streamableConnections.delete(closedSessionId);
    };
    await streamableConnection.server.connect(transport);
    return streamableConnection;
  }
}

export const startMcpServer = async (
  repoRoot: string,
  port: number,
  settings: McpServerSettings = {},
): Promise<McpServerHandle> => {
  const server = new McpHttpServer(repoRoot, settings);
  const startedUrl = await server.start(port);

  return { url: startedUrl, close: () => server.stop() };
};
