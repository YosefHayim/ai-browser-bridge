import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { isNodeError } from "../domain/errors.ts";
import { BRIDGE_DIR_NAME } from "../store/paths.ts";
import { parseFrontmatterMarkdown } from "./custom-commands.parse.ts";
import { splitCommandArguments } from "./custom-commands.args.ts";
import { trimOuterBlankLines } from "./custom-commands.text.helpers.ts";
import { compareCustomCommands, compareStrings, renderTemplateReplacement } from "./custom-commands.render.ts";
import type {
  CommandDir,
  CustomCommand,
  LoadCustomCommandsOptions,
  ParsedCommandFile,
} from "./custom-commands.types.ts";

/** Discover markdown-backed custom commands from user and project command dirs. */
export async function loadCustomCommands(options: LoadCustomCommandsOptions): Promise<CustomCommand[]> {
  const dirs = commandDirs(options);
  const commands: CustomCommand[] = [];
  for (const entry of dirs) {
    commands.push(...await loadCommandsFromDir(entry));
  }
  return commands.sort(compareCustomCommands);
}

function commandDirs(options: LoadCustomCommandsOptions): CommandDir[] {
  const home = options.homeDir ?? process.env.HOME ?? "";
  return [
    { source: "user", dir: resolve(home, BRIDGE_DIR_NAME, "commands") },
    { source: "project", dir: resolve(options.repoRoot, ".bridge", "commands") },
  ];
}

async function loadCommandsFromDir(entry: CommandDir): Promise<CustomCommand[]> {
  const commands: CustomCommand[] = [];
  for (const fileName of await readMarkdownFiles(entry.dir)) {
    commands.push(await loadCommandFile({ entry, fileName }));
  }
  return commands;
}

async function loadCommandFile(input: { entry: CommandDir; fileName: string }): Promise<CustomCommand> {
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

async function readMarkdownFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => entry.name)
      .sort(compareStrings);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
}
