import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { BRIDGE_DIR_NAME } from "@/config";
import { hasErrorCode } from "@/domain/errors.ts";

const FRONTMATTER_KEY_VALUE = /^(?<key>[A-Za-z][A-Za-z0-9_-]*):\s*(?<value>.*)$/;
const FRONTMATTER_LIST_ITEM = /^\s*-\s*(?<item>.+)$/;
const TEMPLATE_PLACEHOLDER = /\$(?<token>ARGUMENTS|\d+)/g;

type CustomCommandSource = "project" | "user";

type CustomCommandMetadata = {
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
  for (const directory of listCommandDirectories(options)) {
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

export const writeCustomCommandPrompt = (
  command: CustomCommand,
  args: string | readonly string[] = "",
): string => {
  const isTypeString = typeof args === "string";
  if (isTypeString) {
    const parsedArguments = splitCommandArguments(args);
    const trimmedArguments = args.trim();
    return replaceTemplatePlaceholders(command.promptTemplate, trimmedArguments, parsedArguments);
  }

  const parsedArguments = [...args];
  return replaceTemplatePlaceholders(
    command.promptTemplate,
    parsedArguments.join(" "),
    parsedArguments,
  );
};

const listCommandDirectories = (options: LoadCustomCommandsOptions): CommandDirectory[] => {
  const homeDirectory = findHomeDir(options.homeDir);
  return [
    {
      source: "user",
      directoryPath: resolve(homeDirectory, BRIDGE_DIR_NAME, "commands"),
    },
    {
      source: "project",
      directoryPath: resolve(options.repoRoot, ".bridge", "commands"),
    },
  ];
};

const findHomeDir = (homeDir: string | undefined): string => {
  const hasHomeDir = homeDir !== undefined;
  if (hasHomeDir) return homeDir;

  const processHome = process.env.HOME;

  const hasProcessHome = processHome !== undefined;
  if (hasProcessHome) return processHome;

  return "";
};

const loadCommandsFromDirectory = async (directory: CommandDirectory): Promise<CustomCommand[]> => {
  const commands: CustomCommand[] = [];
  for (const fileName of await readMarkdownFileNames(directory.directoryPath)) {
    const loadedCommand = await loadCommandFile(directory, fileName);
    commands.push(loadedCommand);
  }
  return commands;
};

const loadCommandFile = async (
  directory: CommandDirectory,
  fileName: string,
): Promise<CustomCommand> => {
  const filePath = join(directory.directoryPath, fileName);
  const commandFileContents = await readFile(filePath, "utf-8");
  const parsed = parseCustomCommandFile(commandFileContents);
  let allowedTools: readonly string[] = [];

  const hasParsedMetadataAllowedTools = parsed.metadata.allowedTools !== undefined;
  if (hasParsedMetadataAllowedTools) {
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
  const isNamesDifferent = byName !== 0;
  if (isNamesDifferent) return byName;

  return left.source.localeCompare(right.source);
};

const compareStrings = (left: string, right: string): number => {
  return left.localeCompare(right);
};

const parseFrontmatterMarkdown = (normalized: string): ParsedCommandFile => {
  const lines = normalized.split("\n");

  const endIndex = findFrontmatterEnd(lines);
  const isEndMarkerNotFound = endIndex === -1;
  if (isEndMarkerNotFound) {
    return { metadata: {}, promptTemplate: trimOuterBlankLines(normalized) };
  }

  const frontmatter = parseFrontmatter(lines.slice(1, endIndex));
  return {
    metadata: frontmatter,
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

  const isLineMissing = line === undefined;
  if (isLineMissing) return index;

  const match = FRONTMATTER_KEY_VALUE.exec(line);
  if (match?.groups === undefined) return index;

  const key = match.groups.key;

  const value = match.groups.value;
  const isPairIncomplete = key == null || value == null;
  if (isPairIncomplete) return index;

  const trimmedField = value.trim();
  return applyFrontmatterKey({ metadata, lines, index, key, value: trimmedField });
};

interface ApplyFrontmatterKeyDetails {
  metadata: CustomCommandMetadata;
  lines: string[];
  index: number;
  key: string;
  value: string;
}

const applyFrontmatterKey = ({
  metadata,
  lines,
  index,
  key,
  value,
}: ApplyFrontmatterKeyDetails): number => {
  const isKeyDescription = key === "description";
  if (isKeyDescription) {
    metadata.description = stripYamlQuotes(value);
    return index;
  }

  const isKeyModel = key === "model";
  if (isKeyModel) {
    metadata.model = stripYamlQuotes(value);
    return index;
  }

  const isKeyAllowedTools = key === "allowedTools";
  if (isKeyAllowedTools) {
    return parseAllowedTools({ metadata, lines, index, value });
  }

  return index;
};

interface ParseAllowedToolsDetails {
  metadata: CustomCommandMetadata;
  lines: string[];
  index: number;
  value: string;
}

const parseAllowedTools = ({ metadata, lines, index, value }: ParseAllowedToolsDetails): number => {
  const isNotEmpty = value !== "";
  if (isNotEmpty) {
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

    const isLineMissing = line === undefined;
    if (isLineMissing) break;

    const listItem = FRONTMATTER_LIST_ITEM.exec(line);
    if (listItem?.groups?.item === undefined) break;

    const trimmedToolName = listItem.groups.item.trim();
    tools.push(stripYamlQuotes(trimmedToolName));
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

  const isCurrentArgumentNotEmpty = state.currentArgument !== "";
  if (isCurrentArgumentNotEmpty) state.parsedArguments.push(state.currentArgument);

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
    const isCurrentArgumentNotEmpty = state.currentArgument !== "";
    if (isCurrentArgumentNotEmpty) state.parsedArguments.push(state.currentArgument);

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

    const isStartMissing = start === undefined;
    if (isStartMissing) continue;

    rendered += promptTemplate.slice(cursor, start);
    const token = match.groups?.token;

    const isTokenARGUMENTS = token === "ARGUMENTS";
    if (isTokenARGUMENTS) {
      rendered += argumentsText;
    } else if (token !== undefined) {
      const position = Number.parseInt(token, 10) - 1;
      const argument = parsedArguments[position];

      const hasArgument = argument !== undefined;
      if (hasArgument) rendered += argument;
    } else {
      rendered += match[0];
    }

    cursor = start + match[0].length;
  }
  rendered += promptTemplate.slice(cursor);
  return rendered;
};

const stripYamlQuotes = (value: string): string => {
  const isQuotedValue =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"));
  if (isQuotedValue) {
    return value.slice(1, -1);
  }

  return value;
};

const parseInlineList = (value: string): string[] => {
  let listText = value;

  const isBracketedList = value.startsWith("[") && value.endsWith("]");
  if (isBracketedList) {
    listText = value.slice(1, -1);
  }

  const tools: string[] = [];
  for (const item of listText.split(",")) {
    const trimmedEntry = item.trim();
    const toolName = stripYamlQuotes(trimmedEntry);
    const isToolNameEmpty = toolName === "";
    if (isToolNameEmpty) continue;

    tools.push(toolName);
  }
  return tools;
};

const trimOuterBlankLines = (value: string): string => {
  return value.replace(/^\n+/, "").replace(/\n+$/, "");
};
