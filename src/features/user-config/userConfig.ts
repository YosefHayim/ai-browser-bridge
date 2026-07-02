import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { hasErrorCode, isNodeError } from "../domain/errors.ts";
import { BRIDGE_DIR_NAME, HOOKS_FILE, homeHooksPath } from "../store/paths.ts";

// ---------------------------------------------------------------------------
// Hook types
// ---------------------------------------------------------------------------

/** Supported hook lifecycle event names. */
export const HOOK_LIFECYCLE_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SessionEnd",
] as const;

/** Hook lifecycle event name. */
export type HookLifecycleEvent = (typeof HOOK_LIFECYCLE_EVENTS)[number];

/** Shell command invoked by a hook entry. */
export type HookCommand = string | readonly string[];

/** Validated hook definition from hooks.json. */
export interface HookDefinition {
  /** Source file path or inline label. */
  source: string;
  /** Lifecycle event that triggers the hook. */
  event: HookLifecycleEvent;
  /** Command to run when execution is enabled. */
  command: HookCommand;
  /** Optional display name. */
  name?: string;
  /** Whether the hook is active. */
  enabled: boolean;
}

/** Result of parsing a hooks.json payload. */
export interface ParseHooksResult {
  /** Valid hook definitions discovered in the payload. */
  hooks: HookDefinition[];
  /** Validation errors collected during parsing. */
  errors: string[];
}

/** Options for loading hook configs from disk. */
export interface LoadHooksOptions {
  /** Repo root whose `.bridge/hooks.json` is loaded first. */
  repoRoot: string;
  /** Optional home directory override for tests. */
  homeDir?: string;
}

/** Loaded hook configs from all search paths. */
export interface LoadedHooksConfig extends ParseHooksResult {
  /** Hook config paths that were searched. */
  paths: string[];
}

/** Status for a hook run attempt. */
export type HookRunStatus = "skipped" | "disabled";

/** Result of attempting to run one hook. */
export interface HookRunResult {
  /** Lifecycle event that was evaluated. */
  event: HookLifecycleEvent;
  /** Hook command that would have run. */
  command: HookCommand;
  /** Whether the hook was skipped or disabled. */
  status: HookRunStatus;
  /** Reason command execution did not occur. */
  reason: "hook-command-execution-disabled" | "hook-disabled";
}

/** Raw hook fields extracted from JSON. */
interface RawHookFields {
  /** Lifecycle event name. */
  event?: unknown;
  /** Command string or argv array. */
  command?: unknown;
  /** Optional hook display name. */
  name?: unknown;
  /** Optional enabled flag. */
  enabled?: unknown;
}

// ---------------------------------------------------------------------------
// Custom command types
// ---------------------------------------------------------------------------

/** Source directory for a custom command definition. */
export type CustomCommandSource = "project" | "user";

/** Optional YAML frontmatter metadata for a custom command. */
export interface CustomCommandMetadata {
  /** Short description shown in help output. */
  description?: string;
  /** Preferred model override for the command. */
  model?: string;
  /** Tool names allowed when running the command. */
  allowedTools?: string[];
}

/** Loaded custom command ready for rendering. */
export interface CustomCommand {
  /** Command name derived from the markdown filename. */
  name: string;
  /** Absolute path to the markdown file. */
  filePath: string;
  /** Whether the command came from project or user config. */
  source: CustomCommandSource;
  /** Optional description from frontmatter. */
  description?: string;
  /** Optional model override from frontmatter. */
  model?: string;
  /** Allowed tool names from frontmatter. */
  allowedTools: string[];
  /** Prompt template body after frontmatter. */
  promptTemplate: string;
}

/** Options for discovering custom commands on disk. */
export interface LoadCustomCommandsOptions {
  /** Repo root whose `.bridge/commands` directory is searched. */
  repoRoot: string;
  /** Optional home directory override. */
  homeDir?: string;
}

/** Parsed markdown command file contents. */
export interface ParsedCommandFile {
  /** Frontmatter metadata when present. */
  metadata: CustomCommandMetadata;
  /** Prompt template body. */
  body: string;
}

/** Directory entry used while scanning command sources. */
interface CommandDir {
  /** Whether commands come from project or user config. */
  source: CustomCommandSource;
  /** Absolute directory path to scan. */
  dir: string;
}

// ---------------------------------------------------------------------------
// Project instruction types
// ---------------------------------------------------------------------------

/** Repo-root instruction file name. */
export interface ProjectInstructionFile {
  fileName: "AGENTS.md" | "CLAUDE.md";
  content: string;
}

/** Loaded project instruction files and rendered prompt text. */
export interface ProjectInstructions {
  files: ProjectInstructionFile[];
  promptText: string;
}

const PROJECT_INSTRUCTION_FILES: Array<ProjectInstructionFile["fileName"]> = [
  "AGENTS.md",
  "CLAUDE.md",
];

// ---------------------------------------------------------------------------
// UserConfig
// ---------------------------------------------------------------------------

/** Reads user and project config from `~/.ai-browser-bridge/` and `.bridge/`. */
export class UserConfig {
  /** Load local and user hook configs, collecting validation errors. */
  async loadHooks(options: LoadHooksOptions): Promise<LoadedHooksConfig> {
    const paths = hookConfigPaths(options.repoRoot, options.homeDir);
    const hooks: HookDefinition[] = [];
    const errors: string[] = [];
    for (const path of paths) {
      const loaded = await this.readHookFile(path);
      if (!loaded) continue;
      hooks.push(...loaded.hooks);
      errors.push(...loaded.errors);
    }
    return { paths, hooks, errors };
  }

  /** Discover markdown-backed custom commands from user and project command dirs. */
  async loadCustomCommands(options: LoadCustomCommandsOptions): Promise<CustomCommand[]> {
    const dirs = this.commandDirs(options);
    const commands: CustomCommand[] = [];
    for (const entry of dirs) {
      commands.push(...(await this.loadCommandsFromDir(entry)));
    }
    return commands.sort(compareCustomCommands);
  }

  /** Load repo-root project instructions for /task prompt augmentation. */
  async loadProjectInstructions(repoRoot: string): Promise<ProjectInstructions> {
    const files: ProjectInstructionFile[] = [];
    for (const fileName of PROJECT_INSTRUCTION_FILES) {
      const content = await this.readOptionalFile(join(repoRoot, fileName));
      if (content !== null) {
        files.push({ fileName, content: content.trim() });
      }
    }
    return {
      files,
      promptText: renderProjectInstructions(files),
    };
  }

  /** Read and parse one hooks.json file from disk. */
  private async readHookFile(path: string): Promise<ParseHooksResult | null> {
    let raw: string;
    try {
      raw = await readFile(path, "utf-8");
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return null;
      throw error;
    }
    try {
      return parseHooksConfig({ raw: JSON.parse(raw), source: path });
    } catch (error) {
      return { hooks: [], errors: [`${path}: invalid JSON (${errorMessage(error)})`] };
    }
  }

  /** Return command directory entries in scan order. */
  private commandDirs(options: LoadCustomCommandsOptions): CommandDir[] {
    const home = options.homeDir ?? process.env.HOME ?? "";
    return [
      { source: "user", dir: resolve(home, BRIDGE_DIR_NAME, "commands") },
      { source: "project", dir: resolve(options.repoRoot, ".bridge", "commands") },
    ];
  }

  /** Load all markdown commands from one directory. */
  private async loadCommandsFromDir(entry: CommandDir): Promise<CustomCommand[]> {
    const commands: CustomCommand[] = [];
    for (const fileName of await this.readMarkdownFiles(entry.dir)) {
      commands.push(await this.loadCommandFile({ entry, fileName }));
    }
    return commands;
  }

  /** Load one custom command markdown file. */
  private async loadCommandFile(input: {
    entry: CommandDir;
    fileName: string;
  }): Promise<CustomCommand> {
    const filePath = join(input.entry.dir, input.fileName);
    const parsed = parseCustomCommandFile(await readFile(filePath, "utf-8"));
    return {
      name: basename(input.fileName, ".md"),
      filePath,
      source: input.entry.source,
      description: parsed.metadata.description,
      model: parsed.metadata.model,
      allowedTools: parsed.metadata.allowedTools ?? [],
      promptTemplate: parsed.body,
    };
  }

  /** List markdown files in a command directory. */
  private async readMarkdownFiles(dir: string): Promise<string[]> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => entry.name)
        .sort(compareStrings);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return [];
      throw error;
    }
  }

  /** Read a file when present, returning null on ENOENT. */
  private async readOptionalFile(path: string): Promise<string | null> {
    try {
      return await readFile(path, "utf-8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return null;
      throw error;
    }
  }
}

/** Return hook config search paths in deterministic load order. */
export function hookConfigPaths(
  input: { repoRoot: string; homeDir?: string } | string,
  homeDir = homedir(),
): string[] {
  const repoRoot = typeof input === "string" ? input : input.repoRoot;
  const home = typeof input === "string" ? homeDir : (input.homeDir ?? homedir());
  return [join(repoRoot, ".bridge", HOOKS_FILE), homeHooksPath(home)];
}

/** Whether a string is a supported hook lifecycle event. */
export function isHookLifecycleEvent(value: string): value is HookLifecycleEvent {
  return (HOOK_LIFECYCLE_EVENTS as readonly string[]).includes(value);
}

/** Whether a value is a supported hook command shape. */
function isHookCommand(value: unknown): value is string | readonly string[] {
  return (
    typeof value === "string" ||
    (Array.isArray(value) && value.every((part) => typeof part === "string"))
  );
}

/** Whether a value is a plain object record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Convert unknown JSON into a record, defaulting to empty. */
function asRecord(raw: unknown): Record<string, unknown> {
  return isRecord(raw) ? raw : {};
}

/** Read one property from a record-like JSON value. */
function readObjectProperty(raw: unknown, property: string): unknown {
  if (!isRecord(raw)) return undefined;
  return raw[property];
}

/** Format an unknown thrown value as a message string. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Compare custom commands for stable sorting by name then source. */
function compareCustomCommands(left: CustomCommand, right: CustomCommand): number {
  const byName = left.name.localeCompare(right.name);
  return byName !== 0 ? byName : left.source.localeCompare(right.source);
}

/** Locale-aware string comparator for sorting file names. */
function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

// ---------------------------------------------------------------------------
// Hook parsing (module-level)
// ---------------------------------------------------------------------------

/** Parse and validate a hooks.json payload without executing anything. */
export function parseHooksConfig(
  input: { raw: unknown; source?: string } | unknown,
  source = "inline",
): ParseHooksResult {
  const payload =
    typeof input === "object" && input !== null && "raw" in input
      ? (input as { raw: unknown; source?: string })
      : { raw: input, source };
  const hooksValue = readObjectProperty(payload.raw, "hooks");
  if (Array.isArray(hooksValue))
    return parseHookArray({ hooksValue, source: payload.source ?? source });
  if (isRecord(hooksValue))
    return parseHookObject({ hooksValue, source: payload.source ?? source });
  return { hooks: [], errors: [`${payload.source ?? source}: hooks must be an array or object`] };
}

/** Parse a hooks array payload. */
function parseHookArray(input: { hooksValue: unknown[]; source: string }): ParseHooksResult {
  const hooks: HookDefinition[] = [];
  const errors: string[] = [];
  for (let index = 0; index < input.hooksValue.length; index += 1) {
    const parsed = parseHookEntry({
      raw: input.hooksValue[index],
      source: input.source,
      location: String(index),
    });
    if (parsed.hook) hooks.push(parsed.hook);
    errors.push(...parsed.errors);
  }
  return { hooks, errors };
}

/** Parse a hooks object keyed by lifecycle event. */
function parseHookObject(input: {
  hooksValue: Record<string, unknown>;
  source: string;
}): ParseHooksResult {
  const hooks: HookDefinition[] = [];
  const errors: string[] = [];
  for (const [eventName, value] of Object.entries(input.hooksValue)) {
    const eventErrors = parseHookEventHooks({ eventName, value, source: input.source, hooks });
    errors.push(...eventErrors);
  }
  return { hooks, errors };
}

/** Parse hooks for one lifecycle event key. */
function parseHookEventHooks(input: {
  eventName: string;
  value: unknown;
  source: string;
  hooks: HookDefinition[];
}): string[] {
  if (!isHookLifecycleEvent(input.eventName)) {
    return [`${input.source}: unsupported hook event ${input.eventName}`];
  }
  if (!Array.isArray(input.value)) {
    return [`${input.source}: ${input.eventName} must be an array`];
  }
  const errors: string[] = [];
  for (let index = 0; index < input.value.length; index += 1) {
    const parsed = parseHookEntry({
      raw: { ...asRecord(input.value[index]), event: input.eventName },
      source: input.source,
      location: `${input.eventName}[${index}]`,
    });
    if (parsed.hook) input.hooks.push(parsed.hook);
    errors.push(...parsed.errors);
  }
  return errors;
}

/** Parse one hook entry from raw JSON. */
function parseHookEntry(input: { raw: unknown; source: string; location: string }): {
  hook?: HookDefinition;
  errors: string[];
} {
  const fields = readHookFields(input.raw);
  const errors = validateHookFields({ fields, source: input.source, location: input.location });
  if (
    errors.length > 0 ||
    typeof fields.event !== "string" ||
    !isHookLifecycleEvent(fields.event)
  ) {
    return { errors };
  }
  if (!isHookCommand(fields.command)) return { errors };
  return {
    hook: {
      source: input.source,
      event: fields.event,
      command: fields.command,
      name: typeof fields.name === "string" ? fields.name : undefined,
      enabled: fields.enabled !== false,
    },
    errors,
  };
}

/** Extract raw hook fields from a JSON value. */
function readHookFields(raw: unknown): RawHookFields {
  if (!isRecord(raw)) return {};
  return { event: raw.event, command: raw.command, name: raw.name, enabled: raw.enabled };
}

/** Validate raw hook fields and return error messages. */
function validateHookFields(input: {
  fields: RawHookFields;
  source: string;
  location: string;
}): string[] {
  const errors: string[] = [];
  if (typeof input.fields.event !== "string" || !isHookLifecycleEvent(input.fields.event)) {
    errors.push(`${input.source}: ${input.location}.event must be a supported lifecycle event`);
  }
  if (!isHookCommand(input.fields.command)) {
    errors.push(`${input.source}: ${input.location}.command must be a string or string array`);
  }
  if (input.fields.name !== undefined && typeof input.fields.name !== "string") {
    errors.push(`${input.source}: ${input.location}.name must be a string`);
  }
  if (input.fields.enabled !== undefined && typeof input.fields.enabled !== "boolean") {
    errors.push(`${input.source}: ${input.location}.enabled must be a boolean`);
  }
  return errors;
}

/** Run hooks for an event without executing shell commands yet. */
export async function runHooks(
  input: { event: HookLifecycleEvent; hooks: readonly HookDefinition[] } | HookLifecycleEvent,
  hooks?: readonly HookDefinition[],
): Promise<HookRunResult[]> {
  const event = typeof input === "string" ? input : input.event;
  const definitions = typeof input === "string" ? (hooks ?? []) : input.hooks;
  return definitions
    .filter((hook) => hook.event === event)
    .map((hook) => mapHookRun({ event, hook }));
}

/** Map one hook definition to a run result. */
function mapHookRun(input: { event: HookLifecycleEvent; hook: HookDefinition }): HookRunResult {
  if (!input.hook.enabled) {
    return {
      event: input.event,
      command: input.hook.command,
      status: "disabled",
      reason: "hook-disabled",
    };
  }
  return {
    event: input.event,
    command: input.hook.command,
    status: "skipped",
    reason: "hook-command-execution-disabled",
  };
}

// ---------------------------------------------------------------------------
// Custom command parsing (module-level)
// ---------------------------------------------------------------------------

/** Parse optional YAML-like frontmatter from a custom command markdown file. */
export function parseCustomCommandFile(markdown: string): ParsedCommandFile {
  const normalized = markdown.replace(/\r\n/g, "\n");
  if (normalized.split("\n")[0]?.trim() !== "---") {
    return { metadata: {}, body: trimOuterBlankLines(normalized) };
  }
  return parseFrontmatterMarkdown(normalized);
}

/** Render a command template with $ARGUMENTS and positional placeholders. */
export function renderCustomCommandPrompt(
  command: CustomCommand,
  args: string | readonly string[] = "",
): string {
  const parsedArgs = typeof args === "string" ? splitCommandArguments(args) : [...args];
  const argumentsText = typeof args === "string" ? args.trim() : parsedArgs.join(" ");
  return command.promptTemplate.replace(/\$(ARGUMENTS|\d+)/g, (match) =>
    renderTemplateReplacement({ match, argumentsText, parsedArgs }),
  );
}

/** Parse markdown with YAML-like frontmatter into metadata and body. */
function parseFrontmatterMarkdown(normalized: string): ParsedCommandFile {
  const lines = normalized.split("\n");
  const endIndex = findFrontmatterEnd(lines);
  if (endIndex === -1) return { metadata: {}, body: trimOuterBlankLines(normalized) };
  return {
    metadata: parseFrontmatter(lines.slice(1, endIndex)),
    body: trimOuterBlankLines(lines.slice(endIndex + 1).join("\n")),
  };
}

/** Find the closing frontmatter delimiter line index. */
function findFrontmatterEnd(lines: string[]): number {
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === "---") return index;
  }
  return -1;
}

/** Parse optional YAML-like frontmatter lines into metadata. */
function parseFrontmatter(lines: string[]): CustomCommandMetadata {
  const metadata: CustomCommandMetadata = {};
  for (let index = 0; index < lines.length; index += 1) {
    index = applyFrontmatterLine({ metadata, lines, index }) ?? index;
  }
  return metadata;
}

/** Apply one frontmatter line to metadata when it matches a key. */
function applyFrontmatterLine(input: {
  metadata: CustomCommandMetadata;
  lines: string[];
  index: number;
}): number | undefined {
  const keyValue = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(input.lines[input.index] ?? "");
  if (!keyValue) return undefined;
  return applyFrontmatterKey({
    metadata: input.metadata,
    lines: input.lines,
    index: input.index,
    key: keyValue[1] ?? "",
    value: (keyValue[2] ?? "").trim(),
  });
}

/** Apply one parsed frontmatter key to metadata. */
function applyFrontmatterKey(input: {
  metadata: CustomCommandMetadata;
  lines: string[];
  index: number;
  key: string;
  value: string;
}): number | undefined {
  if (input.key === "description") input.metadata.description = stripYamlQuotes(input.value);
  if (input.key === "model") input.metadata.model = stripYamlQuotes(input.value);
  if (input.key === "allowedTools")
    return parseAllowedTools({
      metadata: input.metadata,
      lines: input.lines,
      index: input.index,
      value: input.value,
    });
  return input.index;
}

/** Parse allowedTools from inline or list frontmatter. */
function parseAllowedTools(input: {
  metadata: CustomCommandMetadata;
  lines: string[];
  index: number;
  value: string;
}): number {
  if (input.value) {
    input.metadata.allowedTools = parseInlineList(input.value);
    return input.index;
  }
  return parseAllowedToolsList(input);
}

/** Parse a YAML list block for allowedTools. */
function parseAllowedToolsList(input: {
  metadata: CustomCommandMetadata;
  lines: string[];
  index: number;
}): number {
  const list: string[] = [];
  let index = input.index;
  while (index + 1 < input.lines.length) {
    const listItem = /^\s*-\s*(.+)$/.exec(input.lines[index + 1] ?? "");
    if (!listItem) break;
    list.push(stripYamlQuotes((listItem[1] ?? "").trim()));
    index += 1;
  }
  input.metadata.allowedTools = list;
  return index;
}

/** Split a slash-command argument string respecting quotes. */
function splitCommandArguments(input: string): string[] {
  const state = { args: [] as string[], current: "", quote: null as "'" | '"' | null };
  for (const char of input.trim()) {
    const next = consumeArgumentChar({ char, state });
    state.current = next.current;
    state.quote = next.quote;
  }
  if (state.current) state.args.push(state.current);
  return state.args;
}

/** Consume one character while splitting command arguments. */
function consumeArgumentChar(input: {
  char: string;
  state: { args: string[]; current: string; quote: "'" | '"' | null };
}): { current: string; quote: "'" | '"' | null } {
  const { char, state } = input;
  if ((char === "'" || char === '"') && state.quote === null) {
    return { current: state.current, quote: char };
  }
  if (char === state.quote) return { current: state.current, quote: null };
  if (/\s/.test(char) && state.quote === null) {
    if (state.current) state.args.push(state.current);
    return { current: "", quote: state.quote };
  }
  return { current: state.current + char, quote: state.quote };
}

/** Replace one $ARGUMENTS or positional placeholder in a command template. */
function renderTemplateReplacement(input: {
  match: string;
  argumentsText: string;
  parsedArgs: string[];
}): string {
  if (input.match === "$ARGUMENTS") return input.argumentsText;
  const index = Number.parseInt(input.match.slice(1), 10) - 1;
  return input.parsedArgs[index] ?? "";
}

/** Strip surrounding YAML quotes from a scalar value. */
function stripYamlQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/** Parse a comma-separated or bracketed inline YAML list. */
function parseInlineList(value: string): string[] {
  const withoutBrackets = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  return withoutBrackets
    .split(",")
    .map((item) => stripYamlQuotes(item.trim()))
    .filter(Boolean);
}

/** Trim leading and trailing blank lines from markdown bodies. */
function trimOuterBlankLines(value: string): string {
  return value.replace(/^\n+/, "").replace(/\n+$/, "");
}

// ---------------------------------------------------------------------------
// Project instructions (module-level)
// ---------------------------------------------------------------------------

/** Render instruction files with stable headings so multiple files stay distinct. */
export function renderProjectInstructions(files: readonly ProjectInstructionFile[]): string {
  return files
    .filter((file) => file.content.trim())
    .map((file) => `## Project Instructions: ${file.fileName}\n${file.content.trim()}`)
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Convenience wrappers (backward-compatible function exports)
// ---------------------------------------------------------------------------

const defaultUserConfig = new UserConfig();

/** Load local and user hook configs via the default {@link UserConfig} instance. */
export async function loadHooksConfig(options: LoadHooksOptions): Promise<LoadedHooksConfig> {
  return defaultUserConfig.loadHooks(options);
}

/** Discover custom commands via the default {@link UserConfig} instance. */
export async function loadCustomCommands(
  options: LoadCustomCommandsOptions,
): Promise<CustomCommand[]> {
  return defaultUserConfig.loadCustomCommands(options);
}

/** Load project instructions via the default {@link UserConfig} instance. */
export async function loadProjectInstructions(repoRoot: string): Promise<ProjectInstructions> {
  return defaultUserConfig.loadProjectInstructions(repoRoot);
}
