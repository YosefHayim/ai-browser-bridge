import type { CommandSession } from "@/command-types.ts";
import { readErrorMessage } from "@/read-error-message.ts";
import { loadCustomCommands, writeCustomCommandPrompt } from "@/repo-files/custom-commands.ts";
import { SPACE } from "@/terminal/cli/cli-text.ts";
import {
  listCheckpointsCommand,
  restoreCheckpointCommand,
  runRewindPromptCommand,
} from "@/terminal/tui/slash-commands/checkpoint-commands.ts";
import {
  copyTranscriptCommand,
  exportTranscriptCommand,
  listConversationsCommand,
  listSessionsCommand,
  resumeSessionCommand,
  showTranscriptCommand,
} from "@/terminal/tui/slash-commands/conversation-commands.ts";
import { runRouteFilesCommand } from "@/terminal/tui/slash-commands/file-commands.ts";
import {
  attachImageCommand,
  captureScreenshotCommand,
  runUiQaCommand,
} from "@/terminal/tui/slash-commands/image-commands.ts";
import {
  openConnectorCommand,
  runPermissionsCommand,
  runReviewCommand,
  runTaskCommand,
  showMcpCommand,
} from "@/terminal/tui/slash-commands/mcp-commands.ts";
import {
  runModelCommand,
  showEstimateCommand,
} from "@/terminal/tui/slash-commands/model-commands.ts";
import {
  clearChatCommand,
  exitBridgeCommand,
  listCustomCommandsCommand,
  printCustomCommands,
  requestCompactCommand,
  requestDiffCommand,
  runNewCommand,
  showLogsCommand,
  showStatusCommand,
  showStatuslineCommand,
  stopReplyCommand,
} from "@/terminal/tui/slash-commands/session-commands.ts";
import {
  type BuiltinCommandName,
  SLASH_COMMANDS,
  type SlashCommand,
} from "@/terminal/tui/slash-commands/slash-command-list.ts";

const COMMAND_NAME_COLUMN_WIDTH = 16;

async function showHelpCommand(
  _argumentList: string,
  commandSession: CommandSession,
): Promise<void> {
  const allCommands = listRegisteredCommands();

  console.log("\nAvailable commands:\n");

  for (const command of allCommands) {
    const paddedName = command.name.padEnd(COMMAND_NAME_COLUMN_WIDTH);
    console.log(`  /${paddedName} ${command.description}`);
  }

  await printCustomCommands(commandSession);
  console.log("");
}

async function runBuiltinCommand(
  commandName: BuiltinCommandName,
  argumentList: string,
  commandSession: CommandSession,
): Promise<void> {
  switch (commandName) {
    case "files":
      await runRouteFilesCommand(argumentList, commandSession);
      return;
    case "conversations":
      await listConversationsCommand(argumentList, commandSession);
      return;
    case "resume":
      await resumeSessionCommand(argumentList, commandSession);
      return;
    case "sessions":
      await listSessionsCommand(argumentList, commandSession);
      return;
    case "transcript":
      await showTranscriptCommand(argumentList, commandSession);
      return;
    case "copy":
      await copyTranscriptCommand(argumentList, commandSession);
      return;
    case "export":
      await exportTranscriptCommand(argumentList, commandSession);
      return;
    case "checkpoints":
      await listCheckpointsCommand(argumentList, commandSession);
      return;
    case "restore":
      await restoreCheckpointCommand(argumentList, commandSession);
      return;
    case "rewind":
      await runRewindPromptCommand(argumentList, commandSession);
      return;
    case "model":
      await runModelCommand(argumentList, commandSession);
      return;
    case "context":
      await showEstimateCommand(argumentList, commandSession);
      return;
    case "task":
      await runTaskCommand(argumentList, commandSession);
      return;
    case "permissions":
      await runPermissionsCommand(argumentList, commandSession);
      return;
    case "mcp":
      await showMcpCommand(argumentList, commandSession);
      return;
    case "connector":
      await openConnectorCommand(argumentList, commandSession);
      return;
    case "review":
      await runReviewCommand(argumentList, commandSession);
      return;
    case "help":
      await showHelpCommand(argumentList, commandSession);
      return;
    case "new":
      await runNewCommand(argumentList, commandSession);
      return;
    case "stop":
      await stopReplyCommand(argumentList, commandSession);
      return;
    case "compact":
      await requestCompactCommand(argumentList, commandSession);
      return;
    case "commands":
      await listCustomCommandsCommand(argumentList, commandSession);
      return;
    case "logs":
      await showLogsCommand(argumentList, commandSession);
      return;
    case "status":
      await showStatusCommand(argumentList, commandSession);
      return;
    case "statusline":
      await showStatuslineCommand(argumentList, commandSession);
      return;
    case "clear":
      await clearChatCommand(argumentList, commandSession);
      return;
    case "attach-image":
      await attachImageCommand(argumentList, commandSession);
      return;
    case "screenshot":
      await captureScreenshotCommand(argumentList, commandSession);
      return;
    case "ui-qa":
      await runUiQaCommand(argumentList, commandSession);
      return;
    case "diff":
      await requestDiffCommand(argumentList, commandSession);
      return;
    case "exit":
      await exitBridgeCommand(argumentList, commandSession);
      return;
  }
}

async function executeBuiltinCommand(details: {
  parsed: ParsedCommandLine;
  command: SlashCommand;
  commandSession: CommandSession;
}): Promise<boolean> {
  try {
    await runBuiltinCommand(
      details.command.name,
      details.parsed.argumentList,
      details.commandSession,
    );
  } catch (caughtError) {
    const message = readErrorMessage(caughtError);
    console.error(`Command /${details.parsed.name} failed: ${message}`);
  }

  return true;
}

type ParsedCommandLine = { name: string; argumentList: string };

async function executeCustomCommand(details: {
  parsed: ParsedCommandLine;
  commandSession: CommandSession;
}): Promise<boolean> {
  const custom = await findCustomCommand({
    name: details.parsed.name,
    commandSession: details.commandSession,
  });

  const isCustomEmpty = !custom;
  if (isCustomEmpty) return false;

  const customPrompt = writeCustomCommandPrompt(custom, details.parsed.argumentList);
  await details.commandSession.sendMessage(customPrompt);
  return true;
}

function parseCommandLine(commandLine: string): ParsedCommandLine | null {
  const trimmed = commandLine.trim();

  const isNotSlashCommand = !trimmed.startsWith("/");
  if (isNotSlashCommand) return null;

  const parsed = splitCommandNameAndArgumentList(trimmed);

  const isNameEmpty = !parsed.name;
  if (isNameEmpty) return null;

  return parsed;
}

function splitCommandNameAndArgumentList(trimmed: string): ParsedCommandLine {
  const spaceIndex = trimmed.indexOf(SPACE);
  const isSpaceNotFound = spaceIndex === -1;
  const name = isSpaceNotFound ? trimmed.slice(1) : trimmed.slice(1, spaceIndex);
  const argumentList = isSpaceNotFound ? "" : trimmed.slice(spaceIndex + 1);
  return { name, argumentList };
}

async function findCustomCommand(details: { name: string; commandSession: CommandSession }) {
  const custom = await loadCustomCommands({
    repoRoot: details.commandSession.bridgeSettings.repoPath,
  });
  return custom.find((command) => command.name === details.name);
}

const commands = new Map<string, SlashCommand>();

const canonicalNames = new Set<string>();

function registerCommand(command: SlashCommand): void {
  commands.set(command.name, command);
  canonicalNames.add(command.name);

  const aliases = command.aliases ?? [];

  for (const alias of aliases) {
    commands.set(alias, command);
  }
}

export function listRegisteredCommands(): SlashCommand[] {
  const listed: SlashCommand[] = [];
  for (const name of canonicalNames) {
    const command = commands.get(name);

    const isCommandMissing = command == null;
    if (isCommandMissing) continue;

    const isHidden = command.hidden === true;
    if (isHidden) continue;

    listed.push(command);
  }
  return listed;
}

export async function executeCommand(
  commandLine: string,
  commandSession: CommandSession,
): Promise<boolean> {
  const parsed = parseCommandLine(commandLine);

  const isParsedEmpty = !parsed;
  if (isParsedEmpty) return false;

  const command = commands.get(parsed.name);

  const isCommandDefinitionMissing = command == null;
  if (isCommandDefinitionMissing) return executeCustomCommand({ parsed, commandSession });

  return executeBuiltinCommand({ parsed, command, commandSession });
}

export function findCommandsByPartialName(partial: string): SlashCommand[] {
  const lowerPartial = partial.toLowerCase();
  return listRegisteredCommands().filter((command) =>
    command.name.toLowerCase().startsWith(lowerPartial),
  );
}

for (const command of SLASH_COMMANDS) {
  registerCommand(command);
}
