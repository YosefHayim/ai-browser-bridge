import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { BRIDGE_DIR_NAME } from "@/config";
import { hasErrorCode } from "@/features/domain";

const FRONTMATTER_KEY_VALUE = /^(?<key>[A-Za-z][A-Za-z0-9_-]*):\s*(?<value>.*)$/;
const FRONTMATTER_LIST_ITEM = /^\s*-\s*(?<item>.+)$/;
const TEMPLATE_PLACEHOLDER = /\$(?<token>ARGUMENTS|\d+)/g;

export type CustomCommandSource = "project" | "user";

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

type CommandDirectory = {
  readonly source: CustomCommandSource;
  readonly directoryPath: string;
};

type ArgumentSplitState = {
  parsedArguments: string[];
  currentArgument: string;
  quote: "'" | '"' | undefined;
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
    const parsedArguments = splitCommandArguments(args);
    return replaceTemplatePlaceholders(command.promptTemplate, args.trim(), parsedArguments);
  }
  const parsedArguments = [...args];
  return replaceTemplatePlaceholders(
    command.promptTemplate,
    parsedArguments.join(" "),
    parsedArguments,
  );
};

const commandDirectories = (options: LoadCustomCommandsOptions): CommandDirectory[] => {
  return [
    {
      source: "user",
      directoryPath: resolve(resolveHomeDir(options.homeDir), BRIDGE_DIR_NAME, "commands"),
    },
    {
      source: "project",
      directoryPath: resolve(options.repoRoot, ".bridge", "commands"),
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
  for (const fileName of await readMarkdownFileNames(directory.directoryPath)) {
    commands.push(await loadCommandFile(directory, fileName));
  }
  return commands;
};

const loadCommandFile = async (
  directory: CommandDirectory,
  fileName: string,
): Promise<CustomCommand> => {
  const filePath = join(directory.directoryPath, fileName);
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

const readMarkdownFileNames = async (directoryPath: string): Promise<string[]> => {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name)
      .sort(compareStrings);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return [];
    throw error;
  }
};

const compareCustomCommands = (left: CustomCommand, right: CustomCommand): number => {
  const byName = left.name.localeCompare(right.name);
  if (byName !== 0) return byName;
  return left.source.localeCompare(right.source);
};

const compareStrings = (left: string, right: string): number => {
  return left.localeCompare(right);
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
  if (value !== "") {
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
  const state: ArgumentSplitState = {
    parsedArguments: [],
    currentArgument: "",
    quote: undefined,
  };
  for (const char of input.trim()) {
    consumeArgumentChar(char, state);
  }
  if (state.currentArgument !== "") state.parsedArguments.push(state.currentArgument);
  return state.parsedArguments;
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
    if (state.currentArgument !== "") state.parsedArguments.push(state.currentArgument);
    state.currentArgument = "";
    return;
  }
  state.currentArgument += char;
};

const replaceTemplatePlaceholders = (
  promptTemplate: string,
  argumentsText: string,
  parsedArguments: string[],
): string => {
  let rendered = "";
  let cursor = 0;
  for (const match of promptTemplate.matchAll(TEMPLATE_PLACEHOLDER)) {
    const start = match.index;
    if (start === undefined) continue;
    rendered += promptTemplate.slice(cursor, start);
    const token = match.groups?.token;
    if (token === "ARGUMENTS") {
      rendered += argumentsText;
    } else if (token !== undefined) {
      const position = Number.parseInt(token, 10) - 1;
      const argument = parsedArguments[position];
      if (argument !== undefined) rendered += argument;
    } else {
      rendered += match[0];
    }
    cursor = start + match[0].length;
  }
  rendered += promptTemplate.slice(cursor);
  return rendered;
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
  const tools: string[] = [];
  for (const item of listText.split(",")) {
    const toolName = stripYamlQuotes(item.trim());
    if (toolName === "") continue;
    tools.push(toolName);
  }
  return tools;
};

const trimOuterBlankLines = (value: string): string => {
  return value.replace(/^\n+/, "").replace(/\n+$/, "");
};
