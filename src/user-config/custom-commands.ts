import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { BRIDGE_DIRECTORY_NAME } from "@/config";
import { hasErrorCode } from "@/domain/errors.ts";

const DOUBLE_QUOTE = '"';

const SINGLE_QUOTE = "'";

const NEWLINE = "\n";

const MARKDOWN_EXTENSION = ".md";

const COMMANDS_FOLDER_NAME = "commands";

const FRONT_MATTER_DELIMITER = "---";

const FRONTMATTER_KEY_FIELD = /^(?<key>[A-Za-z][A-Za-z0-9_-]*):\s*(?<value>.*)$/;
const FRONTMATTER_LIST_ELEMENT = /^\s*-\s*(?<item>.+)$/;
const TEMPLATE_PLACEHOLDER = /\$(?<token>ARGUMENTS|\d+)/g;

type CustomCommandOrigin = "project" | "user";

type CustomCommandMetadata = {
  description?: string;
  model?: string;
  allowedTools?: string[];
};

export type CustomCommand = {
  readonly name: string;
  readonly filePath: string;
  readonly source: CustomCommandOrigin;
  readonly description?: string;
  readonly model?: string;
  readonly allowedTools: readonly string[];
  readonly promptTemplate: string;
};

export type LoadCustomCommandsSettings = {
  readonly repoRoot: string;
  readonly homeDir?: string;
};

export type ParsedCommandFile = {
  readonly metadata: CustomCommandMetadata;
  readonly promptTemplate: string;
};

type CommandDirectory = {
  readonly source: CustomCommandOrigin;
  readonly directoryPath: string;
};

type ArgumentSplitStatus = {
  parsedArguments: string[];
  currentArgument: string;
  quote: "'" | '"' | null;
};

export const loadCustomCommands = async (
  settings: LoadCustomCommandsSettings,
): Promise<CustomCommand[]> => {
  const commands: CustomCommand[] = [];
  for (const directory of listCommandDirectories(settings)) {
    const directoryCommands = await loadCommandsFromDirectory(directory);
    commands.push(...directoryCommands);
  }
  return commands.sort(compareCustomCommands);
};

export const parseCustomCommandFile = (markdown: string): ParsedCommandFile => {
  const normalized = markdown.replace(/\r\n/g, NEWLINE);
  const firstLine = normalized.split(NEWLINE)[0]?.trim();

  const isFrontMatterMissing = firstLine !== FRONT_MATTER_DELIMITER;
  if (isFrontMatterMissing) {
    return { metadata: {}, promptTemplate: trimOuterBlankLines(normalized) };
  }

  return parseFrontmatterMarkdown(normalized);
};

export const writeCustomCommandPrompt = (
  command: CustomCommand,
  argumentList: string | readonly string[] = "",
): string => {
  const isTypeString = typeof argumentList === "string";
  if (isTypeString) {
    const parsedArguments = splitCommandArguments(argumentList);
    const trimmedArguments = argumentList.trim();
    return replaceTemplatePlaceholders(command.promptTemplate, trimmedArguments, parsedArguments);
  }

  const parsedArguments = [...argumentList];
  const joinedArguments = parsedArguments.join(" ");

  return replaceTemplatePlaceholders(command.promptTemplate, joinedArguments, parsedArguments);
};

const listCommandDirectories = (settings: LoadCustomCommandsSettings): CommandDirectory[] => {
  const homeDirectory = findHomeDirectory(settings.homeDir);

  return [
    {
      source: "user",
      directoryPath: resolve(homeDirectory, BRIDGE_DIRECTORY_NAME, COMMANDS_FOLDER_NAME),
    },
    {
      source: "project",
      directoryPath: resolve(settings.repoRoot, ".bridge", COMMANDS_FOLDER_NAME),
    },
  ];
};

const findHomeDirectory = (homeDirectory: string | undefined): string => {
  const hasHomeDirectory = homeDirectory != null;
  if (hasHomeDirectory) return homeDirectory;

  return homedir();
};

const loadCommandsFromDirectory = async (directory: CommandDirectory): Promise<CustomCommand[]> => {
  const commands: CustomCommand[] = [];

  const fileNames = await readMarkdownFileNames(directory.directoryPath);

  for (const fileName of fileNames) {
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
  const commandFileMessages = await readFile(filePath, "utf-8");
  const parsed = parseCustomCommandFile(commandFileMessages);
  const allowedTools: readonly string[] = parsed.metadata.allowedTools ?? [];

  return {
    name: basename(fileName, MARKDOWN_EXTENSION),
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
    const lines = await readdir(directoryPath, { withFileTypes: true });
    return lines
      .filter((line) => line.isFile() && line.name.endsWith(MARKDOWN_EXTENSION))
      .map((line) => line.name)
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
  const lines = normalized.split(NEWLINE);

  const endIndex = findFrontmatterEnd(lines);

  const isEndMarkerNotFound = endIndex === -1;
  if (isEndMarkerNotFound) {
    return { metadata: {}, promptTemplate: trimOuterBlankLines(normalized) };
  }

  const frontmatterLines = lines.slice(1, endIndex);
  const frontmatter = parseFrontmatter(frontmatterLines);

  const markdownAfterFrontmatter = lines.slice(endIndex + 1).join(NEWLINE);
  return {
    metadata: frontmatter,
    promptTemplate: trimOuterBlankLines(markdownAfterFrontmatter),
  };
};

const findFrontmatterEnd = (lines: string[]): number => {
  for (let index = 1; index < lines.length; index += 1) {
    const trimmedLine = lines[index]?.trim();

    const isDelimiterLine = trimmedLine === FRONT_MATTER_DELIMITER;
    if (isDelimiterLine) return index;
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

  const isLineMissing = line == null;
  if (isLineMissing) return index;

  const hit = FRONTMATTER_KEY_FIELD.exec(line);
  const hitGroups = hit?.groups;

  const isHitGroupsMissing = hitGroups == null;
  if (isHitGroupsMissing) return index;

  const key = hitGroups.key;

  const field = hitGroups.value;

  const isPairIncomplete = key == null || field == null;
  if (isPairIncomplete) return index;

  const trimmedField = field.trim();
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
  value: field,
}: ApplyFrontmatterKeyDetails): number => {
  const isKeyDescription = key === "description";
  if (isKeyDescription) {
    metadata.description = stripYamlQuotes(field);
    return index;
  }

  const isKeyModel = key === "model";
  if (isKeyModel) {
    metadata.model = stripYamlQuotes(field);
    return index;
  }

  const isKeyAllowedTools = key === "allowedTools";
  if (isKeyAllowedTools) {
    return parseAllowedTools({ metadata, lines, index, value: field });
  }

  return index;
};

interface ParseAllowedToolsDetails {
  metadata: CustomCommandMetadata;
  lines: string[];
  index: number;
  value: string;
}

const parseAllowedTools = ({
  metadata,
  lines,
  index,
  value: field,
}: ParseAllowedToolsDetails): number => {
  const isNotEmpty = field !== "";
  if (isNotEmpty) {
    metadata.allowedTools = parseInlineList(field);
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

    const isLineMissing = line == null;
    if (isLineMissing) break;

    const frontmatterListParts = FRONTMATTER_LIST_ELEMENT.exec(line);
    const listedToolName = frontmatterListParts?.groups?.item;

    const isListedToolNameMissing = listedToolName == null;
    if (isListedToolNameMissing) break;

    const trimmedToolName = listedToolName.trim();
    const toolName = stripYamlQuotes(trimmedToolName);
    tools.push(toolName);
    cursor += 1;
  }
  metadata.allowedTools = tools;
  return cursor;
};

const splitCommandArguments = (details: string): string[] => {
  const status: ArgumentSplitStatus = {
    parsedArguments: [],
    currentArgument: "",
    quote: null,
  };
  for (const char of details.trim()) {
    consumeArgumentChar(char, status);
  }

  const isCurrentArgumentNotEmpty = status.currentArgument !== "";
  if (isCurrentArgumentNotEmpty) status.parsedArguments.push(status.currentArgument);

  return status.parsedArguments;
};

const consumeArgumentChar = (char: string, status: ArgumentSplitStatus): void => {
  const isQuoteOpening = (char === SINGLE_QUOTE || char === DOUBLE_QUOTE) && status.quote == null;
  if (isQuoteOpening) {
    status.quote = char;
    return;
  }

  const isQuoteClosing = char === status.quote;
  if (isQuoteClosing) {
    status.quote = null;
    return;
  }

  const isWhitespace = /\s/.test(char);
  const isUnquoted = status.quote == null;

  const isArgumentBreak = isWhitespace && isUnquoted;
  if (isArgumentBreak) {
    const isCurrentArgumentNotEmpty = status.currentArgument !== "";
    if (isCurrentArgumentNotEmpty) status.parsedArguments.push(status.currentArgument);

    status.currentArgument = "";
    return;
  }

  status.currentArgument += char;
};

const replaceTemplatePlaceholders = (
  promptTemplate: string,
  argumentsLine: string,
  parsedArguments: string[],
): string => {
  let rendered = "";
  let cursor = 0;
  for (const hit of promptTemplate.matchAll(TEMPLATE_PLACEHOLDER)) {
    const start = hit.index;

    const isStartMissing = start == null;
    if (isStartMissing) continue;

    rendered += promptTemplate.slice(cursor, start);
    const token = hit.groups?.token;

    const isTokenARGUMENTS = token === "ARGUMENTS";
    const hasTokenNumber = token != null;

    if (isTokenARGUMENTS) {
      rendered += argumentsLine;
    } else if (hasTokenNumber) {
      const decimalRadix = 10;

      const position = Number.parseInt(token, decimalRadix) - 1;
      const argument = parsedArguments[position];

      const hasArgument = argument != null;
      if (hasArgument) rendered += argument;
    } else {
      rendered += hit[0];
    }

    cursor = start + hit[0].length;
  }
  rendered += promptTemplate.slice(cursor);
  return rendered;
};

const stripYamlQuotes = (field: string): string => {
  const isQuotedArgument =
    (field.startsWith(DOUBLE_QUOTE) && field.endsWith(DOUBLE_QUOTE)) ||
    (field.startsWith(SINGLE_QUOTE) && field.endsWith(SINGLE_QUOTE));
  if (isQuotedArgument) {
    return field.slice(1, -1);
  }

  return field;
};

const parseInlineList = (field: string): string[] => {
  let inlineListLiteral = field;

  const isBracketedList = field.startsWith("[") && field.endsWith("]");
  if (isBracketedList) {
    inlineListLiteral = field.slice(1, -1);
  }

  const tools: string[] = [];
  for (const element of inlineListLiteral.split(",")) {
    const trimmedPiece = element.trim();
    const toolName = stripYamlQuotes(trimmedPiece);

    const isToolNameEmpty = toolName === "";
    if (isToolNameEmpty) continue;

    tools.push(toolName);
  }
  return tools;
};

const trimOuterBlankLines = (field: string): string => {
  return field.replace(/^\n+/, "").replace(/\n+$/, "");
};
