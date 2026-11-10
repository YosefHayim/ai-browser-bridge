import type { CommandDef, CommandSession } from "@/domain/command-types.ts";
import { readCliFailureMessage } from "@/terminal/cli-failure.ts";
import { SPACE } from "@/terminal/cli-text.ts";
import { loadCustomCommands, writeCustomCommandPrompt } from "@/user-config/custom-commands.ts";
import {
  listCheckpointsCommand,
  restoreCheckpointCommand,
  runRewindPromptCommand,
} from "./checkpoint-commands.ts";
import {
  copyTranscriptCommand,
  exportTranscriptCommand,
  listConversationsCommand,
  listSessionsCommand,
  resumeSessionCommand,
  showTranscriptCommand,
} from "./conversation-commands.ts";
import { filesCommand } from "./file-commands.ts";
import { attachImageCommand, captureScreenshotCommand, runUiQaCommand } from "./image-commands.ts";
import {
  openConnectorCommand,
  runPermissionsCommand,
  runReviewCommand,
  runTaskCommand,
  showMcpCommand,
} from "./mcp-commands.ts";
import { runModelCommand, showEstimateCommand } from "./model-commands.ts";
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
} from "./session-commands.ts";

type CommandMeta = {
  name: string;
  description: string;
  aliases?: string[];
};

const showHelpCommand = async (
  _argumentList: string,
  commandSession: CommandSession,
): Promise<void> => {
  const all = listRegisteredCommands();

  console.log("\nAvailable commands:\n");

  for (const cmd of all) {
    const commandNameColumnWidth = 16;

    console.log(`  /${cmd.name.padEnd(commandNameColumnWidth)} ${cmd.description}`);
  }

  await printCustomCommands(commandSession);
  console.log("");
};

const BROWSER_HANDLERS: Record<
  string,
  (argumentList: string, commandSession: CommandSession) => Promise<void>
> = {
  help: showHelpCommand,
  new: runNewCommand,
  stop: stopReplyCommand,
  compact: requestCompactCommand,
  commands: listCustomCommandsCommand,
  logs: showLogsCommand,
  status: showStatusCommand,
  statusline: showStatuslineCommand,
  clear: clearChatCommand,
  "attach-image": attachImageCommand,
  screenshot: captureScreenshotCommand,
  "ui-qa": runUiQaCommand,
  diff: requestDiffCommand,
  exit: exitBridgeCommand,
};

const SESSION_HANDLERS: Record<
  string,
  (argumentList: string, commandSession: CommandSession) => Promise<void>
> = {
  conversations: listConversationsCommand,
  resume: resumeSessionCommand,
  sessions: listSessionsCommand,
  transcript: showTranscriptCommand,
  copy: copyTranscriptCommand,
  export: exportTranscriptCommand,
  checkpoints: listCheckpointsCommand,
  restore: restoreCheckpointCommand,
  rewind: runRewindPromptCommand,
};

const MCP_HANDLERS: Record<
  string,
  (argumentList: string, commandSession: CommandSession) => Promise<void>
> = {
  task: runTaskCommand,
  permissions: runPermissionsCommand,
  mcp: showMcpCommand,
  connector: openConnectorCommand,
  review: runReviewCommand,
};

const MODEL_HANDLERS: Record<
  string,
  (argumentList: string, commandSession: CommandSession) => Promise<void>
> = {
  model: runModelCommand,
  context: showEstimateCommand,
};

const executeBuiltinCommand = async (details: {
  parsed: { name: string; args: string };
  cmd: CommandDef;
  commandSession: CommandSession;
}): Promise<boolean> => {
  try {
    await details.cmd.handler(details.parsed.args, details.commandSession);
  } catch (caughtError) {
    const message = readCliFailureMessage(caughtError);
    console.error(`Command /${details.parsed.name} failed: ${message}`);
  }

  return true;
};

const executeCustomCommand = async (details: {
  parsed: { name: string; args: string };
  commandSession: CommandSession;
}): Promise<boolean> => {
  const custom = await findCustomCommand({
    name: details.parsed.name,
    commandSession: details.commandSession,
  });

  const isCustomEmpty = !custom;
  if (isCustomEmpty) return false;

  await details.commandSession.sendMessage(writeCustomCommandPrompt(custom, details.parsed.args));
  return true;
};

const parseCommandLine = (details: string): { name: string; args: string } | null => {
  const trimmed = details.trim();

  const isNotSlashCommand = !trimmed.startsWith("/");
  if (isNotSlashCommand) return null;

  const { name, args: argumentList } = splitCommandNameAndArgumentList(trimmed);

  const isNameEmpty = !name;
  if (isNameEmpty) return null;

  return { name, args: argumentList };
};

const splitCommandNameAndArgumentList = (trimmed: string): { name: string; args: string } => {
  const spaceIndex = trimmed.indexOf(SPACE);
  const isSpaceNotFound = spaceIndex === -1;
  const name = isSpaceNotFound ? trimmed.slice(1) : trimmed.slice(1, spaceIndex);
  const argumentList = isSpaceNotFound ? "" : trimmed.slice(spaceIndex + 1);
  return { name, args: argumentList };
};

const findCustomCommand = async (details: { name: string; commandSession: CommandSession }) => {
  const custom = await loadCustomCommands({ repoRoot: details.commandSession.config.repoPath });
  return custom.find((command) => command.name === details.name);
};

type CommandHandlerMap = Record<string, CommandDef["handler"]>;

type ComposeCommandsDetails = {
  meta: CommandMeta[];
  handlers: CommandHandlerMap;
};

const composeCommands = (details: ComposeCommandsDetails): CommandDef[] => {
  return details.meta.flatMap((line) => {
    const handler = details.handlers[line.name];

    const isHandlerMissing = handler == null;
    if (isHandlerMissing) return [];

    return [{ name: line.name, description: line.description, aliases: line.aliases, handler }];
  });
};

const BUILTIN_COMMANDS: CommandDef[] = [
  filesCommand,
  ...composeCommands({
    meta: [
      { name: "conversations", description: "List and open ChatGPT conversations" },
      {
        name: "resume",
        aliases: ["open"],
        description: "Resume a browser conversation or local session",
      },
      { name: "sessions", description: "List local bridge sessions" },
      { name: "transcript", description: "Print local session transcript" },
      { name: "copy", description: "Copy local session transcript to clipboard" },
      { name: "export", description: "Export local session transcript" },
      { name: "checkpoints", description: "List file checkpoints" },
      { name: "restore", description: "Restore files from a checkpoint" },
      {
        name: "rewind",
        aliases: ["retry"],
        description: "Edit the last prompt, or restore checkpoint files",
      },
    ],
    handlers: SESSION_HANDLERS,
  }),
  ...composeCommands({
    meta: [
      { name: "model", description: "Show or switch the ChatGPT model" },
      { name: "context", description: "Show context window usage" },
    ],
    handlers: MODEL_HANDLERS,
  }),
  ...composeCommands({
    meta: [
      {
        name: "task",
        aliases: ["work"],
        description: "Send a project-agent task with MCP tool instructions",
      },
      { name: "permissions", description: "Show or switch MCP permission mode" },
      { name: "mcp", description: "Show MCP connector setup and exposed tools" },
      { name: "connector", description: "Open ChatGPT MCP connector setup" },
      { name: "review", description: "Ask ChatGPT to review local changes" },
    ],
    handlers: MCP_HANDLERS,
  }),
  ...composeCommands({
    meta: [
      { name: "help", description: "List all available commands" },
      { name: "new", description: "Start a new ChatGPT conversation" },
      { name: "stop", description: "Stop the active ChatGPT response" },
      { name: "compact", description: "Ask ChatGPT for a concise progress summary" },
      { name: "commands", description: "List project/user custom commands" },
      { name: "logs", description: "Show the local bridge log file path" },
      { name: "status", description: "Show bridge status" },
      { name: "statusline", description: "Show status bar fields" },
      { name: "clear", description: "Clear the terminal chat view" },
      { name: "attach-image", description: "Attach a repo image file to ChatGPT" },
      { name: "screenshot", description: "Capture desktop/mobile screenshots for a URL" },
      { name: "ui-qa", description: "Capture UI screenshots and ask ChatGPT to review them" },
      { name: "diff", description: "Show current git diff" },
      { name: "exit", description: "Shutdown the bridge" },
    ],
    handlers: BROWSER_HANDLERS,
  }),
];

const commands = new Map<string, CommandDef>();

const canonicalNames = new Set<string>();

const registerCommand = (cmd: CommandDef): void => {
  commands.set(cmd.name, cmd);
  canonicalNames.add(cmd.name);

  const aliases = cmd.aliases ?? [];

  for (const alias of aliases) {
    commands.set(alias, cmd);
  }
};

export const listRegisteredCommands = (): CommandDef[] => {
  const listed: CommandDef[] = [];
  for (const name of canonicalNames) {
    const command = commands.get(name);

    const isCommandMissing = command == null;
    if (isCommandMissing) continue;

    if (command.hidden) continue;

    listed.push(command);
  }
  return listed;
};

export const executeCommand = async (
  details: string,
  commandSession: CommandSession,
): Promise<boolean> => {
  const parsed = parseCommandLine(details);

  const isParsedEmpty = !parsed;
  if (isParsedEmpty) return false;

  const cmd = commands.get(parsed.name);

  const isCommandDefinitionMissing = cmd == null;
  if (isCommandDefinitionMissing)
    return executeCustomCommand({ parsed, commandSession: commandSession });

  return executeBuiltinCommand({ parsed, cmd, commandSession: commandSession });
};

export const findCommandsByPartialName = (partial: string): CommandDef[] => {
  const q = partial.toLowerCase();
  return listRegisteredCommands().filter((cmd) => cmd.name.toLowerCase().startsWith(q));
};

for (const command of BUILTIN_COMMANDS) {
  registerCommand(command);
}
