import { type ChildProcess, spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import type { Page } from "playwright";
import { createCheckpoint } from "@/features/repoState/checkpoints.ts";
import { downloadsDir, repositoryPath } from "@/features/repoState/paths.ts";
import { chatGptConversationIdFromUrl } from "@/features/webProviders/chatgpt/chatgptConversationUrl.ts";
import {
  downloadAll,
  downloadAttachment,
  loadManifest,
} from "@/features/webProviders/chatgpt/content/chatgptAttachments.ts";
import {
  ApplyPatchArgsSchema,
  DownloadAllAttachmentsArgsSchema,
  DownloadAttachmentArgsSchema,
  GitDiffArgsSchema,
  GrepCodeArgsSchema,
  ListAttachmentsArgsSchema,
  ReadFileArgsSchema,
  RunTestsArgsSchema,
} from "./repoToolSchemas.ts";
import type { RepoToolDefinition, RepoToolResult } from "./toolDefinition.ts";

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

type ReadFileSliceInput = {
  safePath: string;
  path: string;
  startLine: number;
  maxLines: number;
};

type RgArgsInput = {
  pattern: string;
  safePath: string;
  glob?: string;
};

type ApplyPatchInput = {
  patch: string;
  repoRoot: string;
  patchPaths: string[];
};

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

export const isAllowedTestCommand = (parts: string[]): boolean => {
  return ALLOWED_TEST_PREFIXES.some(
    (prefix) => parts.slice(0, prefix.length).join(" ") === prefix.join(" "),
  );
};

export const trimOutput = (text: string, limit = 20_000): string => {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n[trimmed: output exceeded ${limit} chars]`;
};

const runProcess = (
  commandArguments: readonly string[],
  cwd: string,
  options: RunProcessOptions = {},
): Promise<ProcessOutcome> => {
  if (commandArguments.length === 0)
    return Promise.resolve({ stdout: "", stderr: "Empty command.", code: 1 });
  const [command = "", ...rest] = commandArguments;
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
  return new Promise((finish) => {
    const proc = spawn(input.command, input.args, { cwd: input.cwd });
    attachProcessListeners({ proc, timeoutMs: input.timeoutMs, finish });
    writeProcessStdin({ proc, stdin: input.stdin });
  });
};

const attachProcessListeners = (input: {
  proc: ChildProcess;
  timeoutMs: number;
  finish: (outcome: ProcessOutcome) => void;
}): void => {
  const output = { stdout: "", stderr: "" };
  const timer = setTimeout(() => {
    input.proc.kill();
  }, input.timeoutMs);
  attachProcessOutput({ proc: input.proc, output });
  attachProcessCompletion({ proc: input.proc, timer, output, finish: input.finish });
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
  finish: (outcome: ProcessOutcome) => void;
}): void => {
  input.proc.on("close", (code) => {
    clearTimeout(input.timer);
    input.finish({ stdout: input.output.stdout, stderr: input.output.stderr, code });
  });
  input.proc.on("error", (err) => {
    clearTimeout(input.timer);
    input.finish({ stdout: input.output.stdout, stderr: err.message, code: 1 });
  });
};

const writeProcessStdin = (input: { proc: ChildProcess; stdin?: string }): void => {
  if (input.stdin === undefined) return;
  input.proc.stdin?.write(input.stdin);
  input.proc.stdin?.end();
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
  toolRequest: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> => {
  const input = readFileToolInput(toolRequest);
  const invalid = await assertReadableFile({ safePath: input.safePath, path: input.path });
  if (invalid) return invalid;
  return await readNumberedSlice(input);
};

const readFileToolInput = (toolRequest: Record<string, unknown>): ReadFileSliceInput => {
  const path = String(toolRequest.path);
  const repoRoot = String(toolRequest._repoRoot);
  const startLine = toolRequest.start_line === undefined ? 1 : Number(toolRequest.start_line);
  const maxLines = toolRequest.max_lines === undefined ? 200 : Number(toolRequest.max_lines);
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

const readFileToolDef: RepoToolDefinition = {
  name: "read_file",
  description: "Read a repo file with line numbers. Use after grep_code before proposing edits.",
  annotations: { title: "Read file", readOnlyHint: true, openWorldHint: false },
  argsSchema: ReadFileArgsSchema,
  handler: readFileTool,
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
  toolRequest: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> => {
  const input = readGrepInput(toolRequest);
  const outcome = await runProcess(ripgrepArgv(input), input.repoRoot, { timeoutMs: 20_000 });
  return toolResultFromGrep(outcome);
};

const readGrepInput = (
  toolRequest: Record<string, unknown>,
): RgArgsInput & { repoRoot: string } => {
  const repoRoot = String(toolRequest._repoRoot);
  const glob = toolRequest.glob === undefined ? undefined : String(toolRequest.glob);
  return {
    pattern: String(toolRequest.pattern),
    safePath: repositoryPath(repoRoot, String(toolRequest.path)),
    glob,
    repoRoot,
  };
};

const grepTool: RepoToolDefinition = {
  name: "grep_code",
  description:
    "Search the repository using ripgrep. Locate symbols, imports, routes, tests, configs, and references.",
  annotations: { title: "Search repo", readOnlyHint: true, openWorldHint: false },
  argsSchema: GrepCodeArgsSchema,
  handler: grepCode,
};

const runGitApply = async (input: ApplyPatchInput): Promise<{ ok: boolean; output: string }> => {
  const check = await runProcess(["git", "apply", "--check", "-"], input.repoRoot, {
    stdin: input.patch,
    timeoutMs: 20_000,
  });
  if (check.code !== 0) {
    return {
      ok: false,
      output: `Patch check failed:\n${trimOutput(processFailureText(check))}`,
    };
  }
  const applied = await runProcess(["git", "apply", "-"], input.repoRoot, {
    stdin: input.patch,
    timeoutMs: 20_000,
  });
  if (applied.code !== 0) {
    return {
      ok: false,
      output: `Patch apply failed:\n${trimOutput(processFailureText(applied))}`,
    };
  }
  return { ok: true, output: "Patch applied successfully." };
};

const processFailureText = (outcome: ProcessOutcome): string => {
  if (outcome.stderr.length > 0) return outcome.stderr;
  return outcome.stdout;
};

const patchCheckpointNote = async (input: ApplyPatchInput): Promise<string> => {
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
  toolRequest: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> => {
  const input = readApplyPatchInput(toolRequest);
  repositoryPath(input.repoRoot, ".");
  const patchPaths = extractPatchPaths(input.patch);
  const applied = await runGitApply({ patch: input.patch, repoRoot: input.repoRoot, patchPaths });
  if (!applied.ok) return applied;
  const checkpointNote = await patchCheckpointNote({
    patch: input.patch,
    repoRoot: input.repoRoot,
    patchPaths,
  });
  return { ok: true, output: applied.output + checkpointNote };
};

const readApplyPatchInput = (
  toolRequest: Record<string, unknown>,
): { patch: string; repoRoot: string } => {
  return { patch: String(toolRequest.patch), repoRoot: String(toolRequest._repoRoot) };
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

const applyPatchTool: RepoToolDefinition = {
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

const runTests = async (
  toolRequest: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> => {
  const command = String(toolRequest.command);
  const repoRoot = String(toolRequest._repoRoot);
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

const runTestsTool: RepoToolDefinition = {
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

const gitDiff = async (
  toolRequest: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> => {
  const repoRoot = String(toolRequest._repoRoot);
  const [stat, diff] = await Promise.all([
    runProcess(["git", "diff", "--stat"], repoRoot, { timeoutMs: 10_000 }),
    runProcess(["git", "diff"], repoRoot, { timeoutMs: 20_000 }),
  ]);
  const combined = `--- stat ---\n${stat.stdout}\n\n--- diff ---\n${diff.stdout}`;
  return { ok: true, output: trimOutput(combined) };
};

const gitDiffTool: RepoToolDefinition = {
  name: "git_diff",
  description: "Show the current git diff and diff stat for the working tree.",
  annotations: { title: "Show git diff", readOnlyHint: true, openWorldHint: false },
  argsSchema: GitDiffArgsSchema,
  handler: gitDiff,
};

const jsonToolResult = (value: unknown): RepoToolResult => {
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

const conversationIdFromArgs = (toolRequest: Record<string, unknown>): string => {
  if (typeof toolRequest.conversationId === "string" && toolRequest.conversationId.length > 0) {
    return toolRequest.conversationId;
  }
  const page = optionalPage(toolRequest._page);
  if (page === undefined) throw new Error("No active ChatGPT browser page is available.");
  const fromUrl = chatGptConversationIdFromUrl(page.url());
  if (fromUrl === null) return "current";
  return fromUrl;
};

const pageFromArgs = (toolRequest: Record<string, unknown>): Page => {
  const page = optionalPage(toolRequest._page);
  if (page === undefined) throw new Error("No active ChatGPT browser page is available.");
  return page;
};

const attachmentIdsFromArgs = (toolRequest: Record<string, unknown>): string[] | undefined => {
  if (!Array.isArray(toolRequest.ids)) return undefined;
  return toolRequest.ids.filter((id): id is string => typeof id === "string");
};

export const listAttachmentsTool: RepoToolDefinition = {
  name: "chatgpt_list_attachments",
  description:
    "List captured attachments in a ChatGPT conversation, including their assistant/user role.",
  annotations: { title: "List ChatGPT attachments", readOnlyHint: true, openWorldHint: false },
  argsSchema: ListAttachmentsArgsSchema,
  handler: async (toolRequest) => {
    const repoRoot = String(toolRequest._repoRoot);
    const manifest = await loadManifest(conversationIdFromArgs(toolRequest), {
      manifestRoot: downloadsDir(repoRoot),
    });
    return jsonToolResult(manifest.attachments);
  },
};

export const downloadAttachmentTool: RepoToolDefinition = {
  name: "chatgpt_download_attachment",
  description: "Download one captured attachment from the active ChatGPT conversation.",
  annotations: {
    title: "Download ChatGPT attachment",
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  argsSchema: DownloadAttachmentArgsSchema,
  handler: async (toolRequest) => {
    const outDir = optionalString(toolRequest.outDir);
    const repoRoot = String(toolRequest._repoRoot);
    const downloaded = await downloadAttachment(
      pageFromArgs(toolRequest),
      conversationIdFromArgs(toolRequest),
      String(toolRequest.id),
      {
        repoRoot,
        manifestRoot: downloadsDir(repoRoot),
        ...(outDir === undefined ? {} : { outDir }),
      },
    );
    return jsonToolResult(downloaded);
  },
};

export const downloadAllAttachmentsTool: RepoToolDefinition = {
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
  handler: async (toolRequest) => {
    const outDir = optionalString(toolRequest.outDir);
    const repoRoot = String(toolRequest._repoRoot);
    const ids = attachmentIdsFromArgs(toolRequest);
    const downloaded = await downloadAll(
      pageFromArgs(toolRequest),
      conversationIdFromArgs(toolRequest),
      {
        repoRoot,
        manifestRoot: downloadsDir(repoRoot),
        ...(outDir === undefined ? {} : { outDir }),
        ...(ids === undefined ? {} : { ids }),
      },
    );
    return jsonToolResult(downloaded);
  },
};

export const toolRegistry: Map<string, RepoToolDefinition> = new Map();

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
