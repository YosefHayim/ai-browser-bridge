import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

export type CustomCommandSource = "project" | "user";

export interface CustomCommandMetadata {
  description?: string;
  model?: string;
  allowedTools?: string[];
}

export interface CustomCommand {
  name: string;
  filePath: string;
  source: CustomCommandSource;
  description?: string;
  model?: string;
  allowedTools: string[];
  promptTemplate: string;
}

export interface LoadCustomCommandsOptions {
  repoRoot: string;
  homeDir?: string;
}

interface CommandDir {
  source: CustomCommandSource;
  dir: string;
}

export interface ParsedCommandFile {
  metadata: CustomCommandMetadata;
  body: string;
}

/** Discover markdown-backed custom commands from user and project command dirs. */
export async function loadCustomCommands(options: LoadCustomCommandsOptions): Promise<CustomCommand[]> {
  const dirs: CommandDir[] = [
    { source: "user", dir: resolve(options.homeDir ?? process.env.HOME ?? "", ".chatgpt-bridge", "commands") },
    { source: "project", dir: resolve(options.repoRoot, ".bridge", "commands") },
  ];

  const commands: CustomCommand[] = [];
  for (const { source, dir } of dirs) {
    const files = await readMarkdownFiles(dir);
    for (const fileName of files) {
      const filePath = join(dir, fileName);
      const parsed = parseCustomCommandFile(await readFile(filePath, "utf-8"));
      commands.push({
        name: commandNameFromFile(fileName),
        filePath,
        source,
        description: parsed.metadata.description,
        model: parsed.metadata.model,
        allowedTools: parsed.metadata.allowedTools ?? [],
        promptTemplate: parsed.body,
      });
    }
  }

  return commands.sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source));
}

/** Parse optional YAML-like frontmatter from a custom command markdown file. */
export function parseCustomCommandFile(markdown: string): ParsedCommandFile {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0]?.trim() !== "---") {
    return { metadata: {}, body: trimOuterBlankLines(normalized) };
  }

  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (endIndex === -1) {
    return { metadata: {}, body: trimOuterBlankLines(normalized) };
  }

  const metadata = parseFrontmatter(lines.slice(1, endIndex));
  const body = trimOuterBlankLines(lines.slice(endIndex + 1).join("\n"));
  return { metadata, body };
}

/** Render a command template with $ARGUMENTS and $1/$2 positional placeholders expanded. */
export function renderCustomCommandPrompt(command: CustomCommand, args: string | readonly string[] = ""): string {
  const parsedArgs = typeof args === "string" ? splitCommandArguments(args) : [...args];
  const argumentsText = typeof args === "string" ? args.trim() : parsedArgs.join(" ");

  return command.promptTemplate.replace(/\$(ARGUMENTS|\d+)/g, (_match, key: string) => {
    if (key === "ARGUMENTS") return argumentsText;
    const index = Number.parseInt(key, 10) - 1;
    return parsedArgs[index] ?? "";
  });
}

function parseFrontmatter(lines: string[]): CustomCommandMetadata {
  const metadata: CustomCommandMetadata = {};
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const keyValue = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!keyValue) continue;

    const key = keyValue[1];
    const value = keyValue[2].trim();
    if (key === "description") {
      metadata.description = stripYamlQuotes(value);
    } else if (key === "model") {
      metadata.model = stripYamlQuotes(value);
    } else if (key === "allowedTools") {
      if (value) {
        metadata.allowedTools = parseInlineList(value);
      } else {
        const list: string[] = [];
        while (index + 1 < lines.length) {
          const listItem = /^\s*-\s*(.+)$/.exec(lines[index + 1]);
          if (!listItem) break;
          list.push(stripYamlQuotes(listItem[1].trim()));
          index += 1;
        }
        metadata.allowedTools = list;
      }
    }
  }
  return metadata;
}

function parseInlineList(value: string): string[] {
  const withoutBrackets = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  return withoutBrackets
    .split(",")
    .map((item) => stripYamlQuotes(item.trim()))
    .filter(Boolean);
}

function stripYamlQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function trimOuterBlankLines(value: string): string {
  return value.replace(/^\n+/, "").replace(/\n+$/, "");
}

function commandNameFromFile(fileName: string): string {
  return basename(fileName, ".md");
}

async function readMarkdownFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

function splitCommandArguments(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (const char of input.trim()) {
    if ((char === "'" || char === '"') && quote === null) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = null;
      continue;
    }
    if (/\s/.test(char) && quote === null) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current) args.push(current);
  return args;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
