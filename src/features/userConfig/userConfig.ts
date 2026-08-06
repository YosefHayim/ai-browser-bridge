import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { BRIDGE_DIR_NAME } from "@/config";
import { hasErrorCode } from "@/features/domain";
import { HOOKS_FILE, homeHooksPath } from "@/features/store";

export const HOOK_LIFECYCLE_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SessionEnd",
] as const;

const PROJECT_INSTRUCTION_FILE_NAMES = ["AGENTS.md", "CLAUDE.md"] as const;

const FRONTMATTER_KEY_VALUE = /^(?<key>[A-Za-z][A-Za-z0-9_-]*):\s*(?<value>.*)$/;
const FRONTMATTER_LIST_ITEM = /^\s*-\s*(?<item>.+)$/;
const TEMPLATE_PLACEHOLDER = /\$(?<token>ARGUMENTS|\d+)/g;

export type HookLifecycleEvent = (typeof HOOK_LIFECYCLE_EVENTS)[number];
export type HookCommand = string | readonly string[];
export type HookRunStatus = "skipped" | "disabled";
export type CustomCommandSource = "project" | "user";

export type HookDefinition = {
  readonly source: string;
  readonly event: HookLifecycleEvent;
  readonly command: HookCommand;
  readonly name?: string;
  readonly enabled: boolean;
};

export type ParseHooksResult = {
  readonly hooks: HookDefinition[];
  readonly errors: string[];
};

export type LoadHooksOptions = {
  readonly repoRoot: string;
  readonly homeDir?: string;
};

export type LoadedHooksConfig = ParseHooksResult & {
  readonly paths: string[];
};

export type HookRunResult = {
  readonly event: HookLifecycleEvent;
  readonly command: HookCommand;
  readonly status: HookRunStatus;
  readonly reason: "hook-command-execution-disabled" | "hook-disabled";
};

export type CustomCommandMetadata = {
  description?: string;
  model?: string;
  allowedTools?: string[];
};

export type CustomCommand = {
  readonly name: string;
  readonly filePath: string;
  readonly source: CustomCommandSource;
  readonly description?: string;
  readonly model?: string;
  readonly allowedTools: readonly string[];
  readonly promptTemplate: string;
};

export type LoadCustomCommandsOptions = {
  readonly repoRoot: string;
  readonly homeDir?: string;
};

export type ParsedCommandFile = {
  readonly metadata: CustomCommandMetadata;
  readonly promptTemplate: string;
};

export type ProjectInstructionFile = {
  readonly fileName: (typeof PROJECT_INSTRUCTION_FILE_NAMES)[number];
  readonly content: string;
};

export type ProjectInstructions = {
  readonly files: ProjectInstructionFile[];
  readonly promptText: string;
};

type RawHookFields = {
  event?: unknown;
  command?: unknown;
  name?: unknown;
  enabled?: unknown;
};

type CommandDirectory = {
  readonly source: CustomCommandSource;
  readonly dir: string;
};

type ArgumentSplitState = {
  args: string[];
  current: string;
  quote: "'" | '"' | undefined;
};

export const isHookLifecycleEvent = (value: string): value is HookLifecycleEvent => {
  return (HOOK_LIFECYCLE_EVENTS as readonly string[]).includes(value);
};

export const hookConfigPaths = (repoRoot: string, homeDir = homedir()): string[] => {
  return [join(repoRoot, ".bridge", HOOKS_FILE), homeHooksPath(homeDir)];
};

export const parseHooksConfig = (raw: unknown, source = "inline"): ParseHooksResult => {
  const hooksValue = readObjectProperty(raw, "hooks");
  if (Array.isArray(hooksValue)) {
    return parseHookArray(hooksValue, source);
  }
  if (isRecord(hooksValue)) {
    return parseHookObject(hooksValue, source);
  }
  return { hooks: [], errors: [`${source}: hooks must be an array or object`] };
};

/** Shell command execution is intentionally disabled; results report skip/disabled only. */
export const runHooks = async (
  event: HookLifecycleEvent,
  hooks: readonly HookDefinition[],
): Promise<HookRunResult[]> => {
  const results: HookRunResult[] = [];
  for (const hook of hooks) {
    if (hook.event !== event) continue;
    results.push(hookRunResult(event, hook));
  }
  return results;
};

export const loadHooksConfig = async (options: LoadHooksOptions): Promise<LoadedHooksConfig> => {
  const paths = hookConfigPaths(options.repoRoot, options.homeDir);
  const hooks: HookDefinition[] = [];
  const errors: string[] = [];
  for (const path of paths) {
    const loaded = await readHookFile(path);
    if (loaded === undefined) continue;
    hooks.push(...loaded.hooks);
    errors.push(...loaded.errors);
  }
  return { paths, hooks, errors };
};

export const loadCustomCommands = async (
  options: LoadCustomCommandsOptions,
): Promise<CustomCommand[]> => {
  const commands: CustomCommand[] = [];
  for (const directory of commandDirectories(options)) {
    commands.push(...(await loadCommandsFromDirectory(directory)));
  }
  return commands.sort(compareCustomCommands);
};

export const loadProjectInstructions = async (repoRoot: string): Promise<ProjectInstructions> => {
  const files: ProjectInstructionFile[] = [];
  for (const fileName of PROJECT_INSTRUCTION_FILE_NAMES) {
    const content = await readOptionalFile(join(repoRoot, fileName));
    if (content === undefined) continue;
    files.push({ fileName, content: content.trim() });
  }
  return {
    files,
    promptText: renderProjectInstructions(files),
  };
};

export const parseCustomCommandFile = (markdown: string): ParsedCommandFile => {
  const normalized = markdown.replace(/\r\n/g, "\n");
  if (normalized.split("\n")[0]?.trim() !== "---") {
    return { metadata: {}, promptTemplate: trimOuterBlankLines(normalized) };
  }
  return parseFrontmatterMarkdown(normalized);
};

export const renderCustomCommandPrompt = (
  command: CustomCommand,
  args: string | readonly string[] = "",
): string => {
  if (typeof args === "string") {
    const parsedArgs = splitCommandArguments(args);
    return replaceTemplatePlaceholders(command.promptTemplate, args.trim(), parsedArgs);
  }
  const parsedArgs = [...args];
  return replaceTemplatePlaceholders(command.promptTemplate, parsedArgs.join(" "), parsedArgs);
};

export const renderProjectInstructions = (files: readonly ProjectInstructionFile[]): string => {
  return files
    .filter((file) => file.content.trim())
    .map((file) => `## Project Instructions: ${file.fileName}\n${file.content.trim()}`)
    .join("\n\n");
};

const readHookFile = async (path: string): Promise<ParseHooksResult | undefined> => {
  let text: string;
  try {
    text = await readFile(path, "utf-8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
  try {
    return parseHooksConfig(JSON.parse(text), path);
  } catch (error) {
    return { hooks: [], errors: [`${path}: invalid JSON (${errorMessage(error)})`] };
  }
};

const commandDirectories = (options: LoadCustomCommandsOptions): CommandDirectory[] => {
  return [
    {
      source: "user",
      dir: resolve(resolveHomeDir(options.homeDir), BRIDGE_DIR_NAME, "commands"),
    },
    {
      source: "project",
      dir: resolve(options.repoRoot, ".bridge", "commands"),
    },
  ];
};

const resolveHomeDir = (homeDir: string | undefined): string => {
  if (homeDir !== undefined) return homeDir;
  const processHome = process.env.HOME;
  if (processHome !== undefined) return processHome;
  return "";
};

const loadCommandsFromDirectory = async (directory: CommandDirectory): Promise<CustomCommand[]> => {
  const commands: CustomCommand[] = [];
  for (const fileName of await readMarkdownFileNames(directory.dir)) {
    commands.push(await loadCommandFile(directory, fileName));
  }
  return commands;
};

const loadCommandFile = async (
  directory: CommandDirectory,
  fileName: string,
): Promise<CustomCommand> => {
  const filePath = join(directory.dir, fileName);
  const parsed = parseCustomCommandFile(await readFile(filePath, "utf-8"));
  let allowedTools: readonly string[] = [];
  if (parsed.metadata.allowedTools !== undefined) {
    allowedTools = parsed.metadata.allowedTools;
  }
  return {
    name: basename(fileName, ".md"),
    filePath,
    source: directory.source,
    description: parsed.metadata.description,
    model: parsed.metadata.model,
    allowedTools,
    promptTemplate: parsed.promptTemplate,
  };
};

const readMarkdownFileNames = async (dir: string): Promise<string[]> => {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name)
      .sort(compareStrings);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return [];
    throw error;
  }
};

const readOptionalFile = async (path: string): Promise<string | undefined> => {
  try {
    return await readFile(path, "utf-8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
};

const isHookCommand = (value: unknown): value is HookCommand => {
  if (typeof value === "string") return true;
  if (!Array.isArray(value)) return false;
  return value.every((part) => typeof part === "string");
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const readObjectProperty = (raw: unknown, property: string): unknown => {
  if (!isRecord(raw)) return undefined;
  return raw[property];
};

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

const compareCustomCommands = (left: CustomCommand, right: CustomCommand): number => {
  const byName = left.name.localeCompare(right.name);
  if (byName !== 0) return byName;
  return left.source.localeCompare(right.source);
};

const compareStrings = (left: string, right: string): number => {
  return left.localeCompare(right);
};

const parseHookArray = (hooksValue: unknown[], source: string): ParseHooksResult => {
  const hooks: HookDefinition[] = [];
  const errors: string[] = [];
  for (let index = 0; index < hooksValue.length; index += 1) {
    const parsed = parseHookEntry(hooksValue[index], source, String(index));
    if (parsed.hook !== undefined) hooks.push(parsed.hook);
    errors.push(...parsed.errors);
  }
  return { hooks, errors };
};

const parseHookObject = (hooksValue: Record<string, unknown>, source: string): ParseHooksResult => {
  const hooks: HookDefinition[] = [];
  const errors: string[] = [];
  for (const [eventName, value] of Object.entries(hooksValue)) {
    errors.push(...parseHookEventHooks(eventName, value, source, hooks));
  }
  return { hooks, errors };
};

const parseHookEventHooks = (
  eventName: string,
  value: unknown,
  source: string,
  hooks: HookDefinition[],
): string[] => {
  if (!isHookLifecycleEvent(eventName)) {
    return [`${source}: unsupported hook event ${eventName}`];
  }
  if (!Array.isArray(value)) {
    return [`${source}: ${eventName} must be an array`];
  }
  const errors: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    const fields = isRecord(entry) ? { ...entry, event: eventName } : { event: eventName };
    const parsed = parseHookEntry(fields, source, `${eventName}[${index}]`);
    if (parsed.hook !== undefined) hooks.push(parsed.hook);
    errors.push(...parsed.errors);
  }
  return errors;
};

const parseHookEntry = (
  raw: unknown,
  source: string,
  location: string,
): { hook?: HookDefinition; errors: string[] } => {
  const fields = readHookFields(raw);
  const errors = validateHookFields(fields, source, location);
  if (errors.length > 0) return { errors };
  if (typeof fields.event !== "string" || !isHookLifecycleEvent(fields.event)) {
    return { errors };
  }
  if (!isHookCommand(fields.command)) return { errors };

  let name: string | undefined;
  if (typeof fields.name === "string") name = fields.name;

  let enabled = true;
  if (fields.enabled === false) enabled = false;

  return {
    hook: {
      source,
      event: fields.event,
      command: fields.command,
      name,
      enabled,
    },
    errors,
  };
};

const readHookFields = (raw: unknown): RawHookFields => {
  if (!isRecord(raw)) return {};
  return {
    event: raw.event,
    command: raw.command,
    name: raw.name,
    enabled: raw.enabled,
  };
};

const validateHookFields = (fields: RawHookFields, source: string, location: string): string[] => {
  const errors: string[] = [];
  if (typeof fields.event !== "string" || !isHookLifecycleEvent(fields.event)) {
    errors.push(`${source}: ${location}.event must be a supported lifecycle event`);
  }
  if (!isHookCommand(fields.command)) {
    errors.push(`${source}: ${location}.command must be a string or string array`);
  }
  if (fields.name !== undefined && typeof fields.name !== "string") {
    errors.push(`${source}: ${location}.name must be a string`);
  }
  if (fields.enabled !== undefined && typeof fields.enabled !== "boolean") {
    errors.push(`${source}: ${location}.enabled must be a boolean`);
  }
  return errors;
};

const hookRunResult = (event: HookLifecycleEvent, hook: HookDefinition): HookRunResult => {
  if (!hook.enabled) {
    return {
      event,
      command: hook.command,
      status: "disabled",
      reason: "hook-disabled",
    };
  }
  return {
    event,
    command: hook.command,
    status: "skipped",
    reason: "hook-command-execution-disabled",
  };
};

const parseFrontmatterMarkdown = (normalized: string): ParsedCommandFile => {
  const lines = normalized.split("\n");
  const endIndex = findFrontmatterEnd(lines);
  if (endIndex === -1) {
    return { metadata: {}, promptTemplate: trimOuterBlankLines(normalized) };
  }
  return {
    metadata: parseFrontmatter(lines.slice(1, endIndex)),
    promptTemplate: trimOuterBlankLines(lines.slice(endIndex + 1).join("\n")),
  };
};

const findFrontmatterEnd = (lines: string[]): number => {
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === "---") return index;
  }
  return -1;
};

const parseFrontmatter = (lines: string[]): CustomCommandMetadata => {
  const metadata: CustomCommandMetadata = {};
  for (let index = 0; index < lines.length; index += 1) {
    index = applyFrontmatterLine(metadata, lines, index);
  }
  return metadata;
};

const applyFrontmatterLine = (
  metadata: CustomCommandMetadata,
  lines: string[],
  index: number,
): number => {
  const line = lines[index];
  if (line === undefined) return index;
  const match = FRONTMATTER_KEY_VALUE.exec(line);
  if (match?.groups === undefined) return index;
  const key = match.groups.key;
  const value = match.groups.value;
  if (key === undefined || value === undefined) return index;
  return applyFrontmatterKey(metadata, lines, index, key, value.trim());
};

const applyFrontmatterKey = (
  metadata: CustomCommandMetadata,
  lines: string[],
  index: number,
  key: string,
  value: string,
): number => {
  if (key === "description") {
    metadata.description = stripYamlQuotes(value);
    return index;
  }
  if (key === "model") {
    metadata.model = stripYamlQuotes(value);
    return index;
  }
  if (key === "allowedTools") {
    return parseAllowedTools(metadata, lines, index, value);
  }
  return index;
};

const parseAllowedTools = (
  metadata: CustomCommandMetadata,
  lines: string[],
  index: number,
  value: string,
): number => {
  if (value) {
    metadata.allowedTools = parseInlineList(value);
    return index;
  }
  return parseAllowedToolsList(metadata, lines, index);
};

const parseAllowedToolsList = (
  metadata: CustomCommandMetadata,
  lines: string[],
  index: number,
): number => {
  const tools: string[] = [];
  let cursor = index;
  while (cursor + 1 < lines.length) {
    const line = lines[cursor + 1];
    if (line === undefined) break;
    const listItem = FRONTMATTER_LIST_ITEM.exec(line);
    if (listItem?.groups?.item === undefined) break;
    tools.push(stripYamlQuotes(listItem.groups.item.trim()));
    cursor += 1;
  }
  metadata.allowedTools = tools;
  return cursor;
};

const splitCommandArguments = (input: string): string[] => {
  const state: ArgumentSplitState = { args: [], current: "", quote: undefined };
  for (const char of input.trim()) {
    consumeArgumentChar(char, state);
  }
  if (state.current) state.args.push(state.current);
  return state.args;
};

const consumeArgumentChar = (char: string, state: ArgumentSplitState): void => {
  if ((char === "'" || char === '"') && state.quote === undefined) {
    state.quote = char;
    return;
  }
  if (char === state.quote) {
    state.quote = undefined;
    return;
  }
  if (/\s/.test(char) && state.quote === undefined) {
    if (state.current) state.args.push(state.current);
    state.current = "";
    return;
  }
  state.current += char;
};

const replaceTemplatePlaceholders = (
  promptTemplate: string,
  argumentsText: string,
  parsedArgs: string[],
): string => {
  return promptTemplate.replace(TEMPLATE_PLACEHOLDER, (match) => {
    if (match === "$ARGUMENTS") return argumentsText;
    const position = Number.parseInt(match.slice(1), 10) - 1;
    const value = parsedArgs[position];
    if (value === undefined) return "";
    return value;
  });
};

const stripYamlQuotes = (value: string): string => {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
};

const parseInlineList = (value: string): string[] => {
  let listText = value;
  if (value.startsWith("[") && value.endsWith("]")) {
    listText = value.slice(1, -1);
  }
  return listText
    .split(",")
    .map((item) => stripYamlQuotes(item.trim()))
    .filter(Boolean);
};

const trimOuterBlankLines = (value: string): string => {
  return value.replace(/^\n+/, "").replace(/\n+$/, "");
};
