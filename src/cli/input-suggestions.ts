import { readdir } from "node:fs/promises";
import { extname, sep } from "node:path";
import type { CommandDef } from "../types/types.ts";
import { ensureInsideRepo } from "../mcp/sandbox.ts";
import { completeFileMention } from "./file-autocomplete.ts";
import { listModelProfiles } from "../core/model-catalog.ts";
import { listSessions, type SessionStoreOptions } from "../core/session-store.ts";
import { listCheckpoints, type CheckpointSummary } from "../core/checkpoints.ts";
import { sessionsDir } from "../core/paths.ts";
import { loadCustomCommands } from "../core/custom-commands.ts";
import { PERMISSION_MODES } from "../core/permissions.ts";

export type SuggestionKind =
  | "command"
  | "file"
  | "folder"
  | "mode"
  | "session"
  | "checkpoint"
  | "model"
  | "scope"
  | "flag"
  | "url"
  | "text";

export interface InputSuggestion {
  value: string;
  label: string;
  kind: SuggestionKind;
  detail?: string;
}

export interface InputSuggestionGroup {
  title: string;
  hint?: string;
  replacementStart?: number;
  replacementEnd?: number;
  suggestions: InputSuggestion[];
}

export interface LoadInputSuggestionsOptions {
  repoRoot: string;
  commands: readonly CommandDef[];
  limit?: number;
  sessionOptions?: SessionStoreOptions;
  checkpointRoot?: string;
  customCommandsHomeDir?: string;
}

interface ParsedSlashInput {
  command: string;
  args: string;
  argsStart: number;
}

interface CommandSuggestionRule {
  title: string;
  hint: string;
  values?: readonly InputSuggestion[];
}

const DEFAULT_LIMIT = 8;
const IGNORED_COMPLETION_ENTRIES = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".turbo"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

export const COMMAND_SUGGESTION_RULES: Record<string, CommandSuggestionRule> = {
  help: { title: "Help", hint: "Press Enter to list commands." },
  conversations: { title: "Conversations", hint: "Press Enter to list browser conversations, or type a title/id filter." },
  resume: { title: "Resume", hint: "Choose --last, a local session id, or type a browser conversation title/id." },
  open: { title: "Resume", hint: "Alias for /resume. Choose --last, a local session id, or type a browser conversation title/id." },
  new: { title: "New Conversation", hint: "Press Enter to start a new ChatGPT conversation." },
  model: { title: "Models", hint: "Choose a known model label, or type a browser model name." },
  rewind: { title: "Rewind", hint: "Type replacement prompt text, or choose --files/--both then a checkpoint id." },
  retry: { title: "Rewind", hint: "Alias for /rewind. Type replacement prompt text, or choose --files/--both then a checkpoint id." },
  stop: { title: "Stop", hint: "Press Enter to stop the active ChatGPT response." },
  compact: { title: "Compact", hint: "Press Enter to ask ChatGPT for a concise progress summary." },
  task: { title: "Task", hint: "Type the project task. Use @ to mention files and folders." },
  work: { title: "Task", hint: "Alias for /task. Type the project task. Use @ to mention files and folders." },
  commands: { title: "Custom Commands", hint: "Press Enter to list project/user custom commands." },
  context: { title: "Context", hint: "Press Enter to show context usage." },
  logs: { title: "Logs", hint: "Press Enter to show today's local bridge log path." },
  sessions: { title: "Sessions", hint: "Press Enter to list local bridge sessions." },
  transcript: { title: "Transcript", hint: "Choose a local session id, or press Enter for the current session." },
  copy: { title: "Copy", hint: "Choose a local session id, or press Enter for the current session transcript." },
  export: { title: "Export", hint: "Choose a session id, or type an output path ending in .md, .json, or .jsonl." },
  permissions: {
    title: "Permissions",
    hint: "Choose the MCP tool permission mode.",
    values: PERMISSION_MODES.map((mode) => ({
      value: mode,
      label: mode,
      kind: "mode",
      detail: mode === "auto" ? "allow narrow write/test tools" : mode === "ask" ? "block until confirmation exists" : "read tools only",
    })),
  },
  checkpoints: { title: "Checkpoints", hint: "Press Enter to list file checkpoints." },
  restore: { title: "Restore", hint: "Choose a checkpoint id, then optionally type repo paths to restore." },
  review: {
    title: "Review",
    hint: "Choose review scope.",
    values: [
      { value: "working", label: "working", kind: "scope", detail: "review current working tree" },
      { value: "base", label: "base", kind: "scope", detail: "review against base branch" },
      { value: "commit", label: "commit", kind: "scope", detail: "review a commit" },
    ],
  },
  status: { title: "Status", hint: "Press Enter to show bridge status." },
  statusline: { title: "Statusline", hint: "Press Enter to show status bar fields." },
  mcp: { title: "MCP", hint: "Press Enter to show connector setup, exposed tools, and troubleshooting steps." },
  connector: { title: "Connector", hint: "Press Enter to open ChatGPT Apps setup and fill the current Connector URL when possible." },
  clear: { title: "Clear", hint: "Press Enter to clear the terminal chat view. Browser conversation and logs remain unchanged." },
  "attach-image": { title: "Attach Image", hint: "Choose a repo image file. Directories are shown for navigation." },
  screenshot: { title: "Screenshot", hint: "Type a http:// or https:// URL to capture desktop/mobile screenshots.", values: [{ value: "https://", label: "https://", kind: "url" }] },
  "ui-qa": { title: "UI QA", hint: "Type a http:// or https:// URL to capture screenshots and request UI review.", values: [{ value: "https://", label: "https://", kind: "url" }] },
  diff: { title: "Diff", hint: "Press Enter to ask ChatGPT to inspect the current git diff." },
  files: {
    title: "Files",
    hint: "Press Enter to list attachments, or type get <id> / get all [--out <dir>] to download.",
    values: [
      { value: "get", label: "get", kind: "text", detail: "download an attachment by id, or 'all'" },
      { value: "get all", label: "get all", kind: "text", detail: "download every attachment" },
      { value: "--out", label: "--out", kind: "flag", detail: "output directory for downloads" },
    ],
  },
  exit: { title: "Exit", hint: "Press Enter to shut down the bridge." },
};

export async function loadInputSuggestions(
  input: string,
  options: LoadInputSuggestionsOptions,
): Promise<InputSuggestionGroup | null> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const fileMention = await completeFileMention(input, options.repoRoot, { limit });
  if (fileMention) {
    return {
      title: "Files and folders",
      hint: "Tab inserts the first match. Continue typing to narrow.",
      replacementStart: fileMention.start,
      replacementEnd: fileMention.end,
      suggestions: fileMention.matches.map((match) => ({
        value: `@${match.path}`,
        label: `@${match.path}`,
        kind: match.isDirectory ? "folder" : "file",
      })),
    };
  }

  const slash = parseSlashInput(input);
  if (!slash) return null;

  if (!input.includes(" ")) {
    return commandNameSuggestions(slash.command, options.commands, options);
  }

  return commandArgumentSuggestions(slash, options);
}

export function applyInputSuggestion(input: string, group: InputSuggestionGroup, index = 0): string {
  const suggestion = group.suggestions[index];
  if (!suggestion || group.replacementStart === undefined || group.replacementEnd === undefined) {
    return input;
  }
  return `${input.slice(0, group.replacementStart)}${suggestion.value}${input.slice(group.replacementEnd)}`;
}

export function commandSuggestionCoverage(commands: readonly CommandDef[]): string[] {
  return commands
    .map((command) => command.name)
    .filter((name) => !COMMAND_SUGGESTION_RULES[name]);
}

async function commandNameSuggestions(
  partial: string,
  commands: readonly CommandDef[],
  options: LoadInputSuggestionsOptions,
): Promise<InputSuggestionGroup | null> {
  const custom = await loadCustomCommands({
    repoRoot: options.repoRoot,
    homeDir: options.customCommandsHomeDir,
  });
  const builtIns = commands.map((command) => ({
    value: `/${command.name} `,
    label: `/${command.name}`,
    kind: "command" as const,
    detail: command.description,
  }));
  const customSuggestions = custom.map((command) => ({
    value: `/${command.name} `,
    label: `/${command.name}`,
    kind: "command" as const,
    detail: command.description ?? `${command.source} custom command`,
  }));
  const query = partial.toLowerCase();
  const suggestions = [...builtIns, ...customSuggestions]
    .filter((suggestion) => suggestion.label.slice(1).toLowerCase().startsWith(query))
    .slice(0, options.limit ?? DEFAULT_LIMIT);

  return {
    title: "Commands",
    hint: "Tab inserts the first command. Enter runs the selected command.",
    replacementStart: 0,
    replacementEnd: partial.length + 1,
    suggestions,
  };
}

async function commandArgumentSuggestions(
  slash: ParsedSlashInput,
  options: LoadInputSuggestionsOptions,
): Promise<InputSuggestionGroup | null> {
  const rule = COMMAND_SUGGESTION_RULES[slash.command] ?? {
    title: `/${slash.command}`,
    hint: "Type arguments for this command. Use @ to mention repo files.",
  };
  const token = activeArgumentToken(slash);
  const base: InputSuggestionGroup = {
    title: rule.title,
    hint: rule.hint,
    replacementStart: token.start,
    replacementEnd: token.end,
    suggestions: [],
  };

  if (slash.command === "resume" || slash.command === "open") {
    return withFilteredSuggestions(base, [
      { value: "--last", label: "--last", kind: "flag", detail: "latest local bridge session" },
      ...(await sessionSuggestions(options)),
    ], token.value, options.limit);
  }

  if (slash.command === "transcript" || slash.command === "copy") {
    return withFilteredSuggestions(base, await sessionSuggestions(options), token.value, options.limit);
  }

  if (slash.command === "export") {
    const tokens = splitArgs(slash.args);
    if (tokens.length === 0 || (tokens.length === 1 && !hasTrailingWhitespace(slash.args))) {
      return withFilteredSuggestions(base, await sessionSuggestions(options), token.value, options.limit);
    }
    return { ...base, hint: "Type the export output path. Supported extensions: .md, .json, .jsonl." };
  }

  if (slash.command === "permissions") {
    return withFilteredSuggestions(base, rule.values ?? [], token.value, options.limit);
  }

  if (slash.command === "model") {
    const models = listModelProfiles().map((profile) => ({
      value: profile.label,
      label: profile.label,
      kind: "model" as const,
      detail: `${profile.contextWindow.toLocaleString()} ctx`,
    }));
    return withFilteredSuggestions(base, models, token.value, options.limit);
  }

  if (slash.command === "restore") {
    const tokens = splitArgs(slash.args);
    if (tokens.length === 0 || (tokens.length === 1 && !hasTrailingWhitespace(slash.args))) {
      return withFilteredSuggestions(base, await checkpointSuggestions(options), token.value, options.limit);
    }
    return pathSuggestionGroup(base, token.value, options, "all");
  }

  if (slash.command === "rewind" || slash.command === "retry") {
    const tokens = splitArgs(slash.args);
    const firstToken = tokens[0];
    if ((firstToken === "--files" || firstToken === "--both") && (tokens.length > 1 || hasTrailingWhitespace(slash.args))) {
      return withFilteredSuggestions(base, await checkpointSuggestions(options), token.value, options.limit);
    }
    if (tokens.length <= 1) {
      return withFilteredSuggestions(base, [
        { value: "--files", label: "--files", kind: "flag", detail: "restore files only" },
        { value: "--both", label: "--both", kind: "flag", detail: "restore files and retry prompt" },
      ], token.value, options.limit);
    }
    if (firstToken === "--files" || firstToken === "--both") {
      return withFilteredSuggestions(base, await checkpointSuggestions(options), token.value, options.limit);
    }
    return base;
  }

  if (slash.command === "review") {
    return withFilteredSuggestions(base, rule.values ?? [], token.value, options.limit);
  }

  if (slash.command === "attach-image") {
    return pathSuggestionGroup(base, token.value, options, "image");
  }

  if (slash.command === "screenshot" || slash.command === "ui-qa") {
    return withFilteredSuggestions(base, rule.values ?? [], token.value, options.limit);
  }

  if (slash.command === "task" || slash.command === "work") {
    return {
      ...base,
      replacementStart: undefined,
      replacementEnd: undefined,
      hint: "Describe the coding task. Type @ to see repo files and folders.",
    };
  }

  return withFilteredSuggestions(base, rule.values ?? [], token.value, options.limit);
}

async function sessionSuggestions(options: LoadInputSuggestionsOptions): Promise<InputSuggestion[]> {
  const sessions = await listSessions(
    options.sessionOptions ?? { baseDir: sessionsDir(options.repoRoot) },
  );
  return sessions.slice(0, options.limit ?? DEFAULT_LIMIT).map((session) => ({
    value: session.id,
    label: session.id,
    kind: "session",
    detail: `${session.updatedAt} ${session.model ?? "unknown"}`,
  }));
}

async function checkpointSuggestions(options: LoadInputSuggestionsOptions): Promise<InputSuggestion[]> {
  const checkpoints = await listCheckpoints({
    repoRoot: options.repoRoot,
    checkpointRoot: options.checkpointRoot,
  });
  return checkpoints.slice(0, options.limit ?? DEFAULT_LIMIT).map((checkpoint: CheckpointSummary) => ({
    value: checkpoint.id,
    label: checkpoint.id,
    kind: "checkpoint",
    detail: `${checkpoint.phase} ${checkpoint.fileCount} files ${checkpoint.label ?? ""}`.trim(),
  }));
}

async function pathSuggestionGroup(
  base: InputSuggestionGroup,
  partial: string,
  options: LoadInputSuggestionsOptions,
  kind: "all" | "image",
): Promise<InputSuggestionGroup> {
  const matches = await repoPathSuggestions(options.repoRoot, partial, kind, options.limit ?? DEFAULT_LIMIT);
  return {
    ...base,
    suggestions: matches,
    hint: matches.length > 0 ? "Tab inserts the first path. Directories end with /." : base.hint,
  };
}

async function repoPathSuggestions(
  repoRoot: string,
  partial: string,
  kind: "all" | "image",
  limit: number,
): Promise<InputSuggestion[]> {
  const normalized = partial.replaceAll("\\", "/").replaceAll(sep, "/");
  if (normalized.startsWith("/") || normalized.split("/").includes("..")) return [];

  const slashIndex = normalized.lastIndexOf("/");
  const dirPrefix = slashIndex === -1 ? "" : normalized.slice(0, slashIndex);
  const namePrefix = slashIndex === -1 ? normalized : normalized.slice(slashIndex + 1);
  const searchDir = dirPrefix || ".";

  let absoluteSearchDir: string;
  try {
    absoluteSearchDir = ensureInsideRepo(searchDir, repoRoot);
  } catch {
    return [];
  }

  try {
    const entries = await readdir(absoluteSearchDir, { withFileTypes: true });
    return entries
      .filter((entry) => !IGNORED_COMPLETION_ENTRIES.has(entry.name))
      .filter((entry) => namePrefix.startsWith(".") || !entry.name.startsWith("."))
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .filter((entry) => entry.name.startsWith(namePrefix))
      .filter((entry) => {
        if (entry.isDirectory()) return true;
        return kind === "all" || IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase());
      })
      .map((entry) => {
        const path = dirPrefix ? `${dirPrefix}/${entry.name}` : entry.name;
        const isDirectory = entry.isDirectory();
        const value = isDirectory ? `${path}/` : path;
        return {
          value,
          label: value,
          kind: isDirectory ? "folder" as const : "file" as const,
          detail: isDirectory ? "folder" : undefined,
        };
      })
      .sort(comparePathSuggestions)
      .slice(0, limit);
  } catch {
    return [];
  }
}

function withFilteredSuggestions(
  group: InputSuggestionGroup,
  suggestions: readonly InputSuggestion[],
  query: string,
  limit = DEFAULT_LIMIT,
): InputSuggestionGroup {
  const normalizedQuery = query.toLowerCase();
  return {
    ...group,
    suggestions: suggestions
      .filter((suggestion) => suggestion.value.toLowerCase().includes(normalizedQuery))
      .slice(0, limit),
  };
}

function parseSlashInput(input: string): ParsedSlashInput | null {
  if (!input.startsWith("/")) return null;
  const spaceIndex = input.indexOf(" ");
  if (spaceIndex === -1) {
    return { command: input.slice(1), args: "", argsStart: input.length };
  }
  return {
    command: input.slice(1, spaceIndex),
    args: input.slice(spaceIndex + 1),
    argsStart: spaceIndex + 1,
  };
}

function activeArgumentToken(slash: ParsedSlashInput): { start: number; end: number; value: string } {
  const beforeCursor = slash.args;
  const match = /(?:^|\s)(\S*)$/.exec(beforeCursor);
  const value = match?.[1] ?? "";
  const start = slash.argsStart + beforeCursor.length - value.length;
  return { start, end: slash.argsStart + beforeCursor.length, value };
}

function splitArgs(input: string): string[] {
  return input.trim().split(/\s+/).filter(Boolean);
}

function hasTrailingWhitespace(input: string): boolean {
  return /\s$/.test(input);
}

function comparePathSuggestions(left: InputSuggestion, right: InputSuggestion): number {
  if (left.kind !== right.kind) {
    if (left.kind === "folder") return -1;
    if (right.kind === "folder") return 1;
  }
  return left.label.localeCompare(right.label);
}
