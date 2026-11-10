import type { CommandSession } from "@/domain/command-types.ts";
import { readProviderIdFrom } from "@/providers/providers.ts";
import { readBridgeLogPath } from "@/store/logging.ts";
import { NEWLINE } from "@/terminal/cli-text.ts";
import { readMcpConnectorUrl } from "@/terminal/project-task-prompt.ts";
import { loadCustomCommands } from "@/user-config/custom-commands.ts";

const CUSTOM_COMMANDS_HEADING = "\nCustom commands:\n";

const createBridgeStatus = (commandScope: CommandSession): string => {
  const provider = readProviderIdFrom(commandScope.config.provider);

  return [
    `Provider: ${provider}`,
    `Repo: ${commandScope.config.repoPath}`,
    `Branch: ${readStatusBranchLabel(commandScope)}`,
    `Session: ${readStatusSessionLabel(commandScope)}`,
    `Model: ${commandScope.counter.modelLabel}`,
    `Context: ${commandScope.counter.summary}`,
    `Permission: ${readStatusPermissionLabel(commandScope)}`,
    `Tool calls: ${readStatusToolCallCount(commandScope)}`,
    `Tunnel: ${readStatusTunnelLabel(commandScope)}`,
    `Connector: ${readStatusConnectorLabel(commandScope)}`,
  ].join(NEWLINE);
};

const readStatusBranchLabel = (commandScope: CommandSession): string => {
  const branch = commandScope.statusline?.branch;

  const isBranchBlank = branch == null || branch === "";
  if (isBranchBlank) return "unknown";

  return branch;
};

const readStatusSessionLabel = (commandScope: CommandSession): string => {
  const sessionId = commandScope.session?.getId();

  const isSessionIdBlank = sessionId == null || sessionId === "";
  if (isSessionIdBlank) return "none";

  return sessionId;
};

export const readStatusPermissionLabel = (commandScope: CommandSession): string => {
  const liveMode = commandScope.permission?.getMode();

  const hasLiveMode = liveMode != null;
  if (hasLiveMode) return liveMode;

  if (commandScope.config.permissionMode != null) return commandScope.config.permissionMode;

  return "auto";
};

export const readStatusToolCallCount = (commandScope: CommandSession): number => {
  const liveCount = commandScope.statusline?.toolCallCount();

  const hasLiveCount = liveCount != null;
  if (hasLiveCount) return liveCount;

  return 0;
};

export const readStatusTunnelLabel = (commandScope: CommandSession): string => {
  if (commandScope.config.tunnelUrl == null || commandScope.config.tunnelUrl === "") return "none";

  return commandScope.config.tunnelUrl;
};

export const readStatusConnectorLabel = (commandScope: CommandSession): string => {
  const connector = readMcpConnectorUrl(commandScope.config.tunnelUrl);

  const isConnectorMissing = connector == null;
  if (isConnectorMissing) return "none";

  return connector;
};

export const runNewCommand = async (
  _argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  await commandScope.orchestrator.openNewConversation();
  console.log("Started new conversation.");
};

export const stopReplyCommand = async (
  _argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  const stopped = await commandScope.orchestrator.stopReply();
  console.log(stopped ? "Stopped active response." : "No active response to stop.");
};

export const requestCompactCommand = async (
  _argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  await commandScope.sendMessage(
    "Summarize our progress so far in a structured format: what we've done, what's in progress, what's next. Be concise.",
  );
  console.log(
    "Compaction summary requested. Start a new conversation to continue with that summary.",
  );
};

export const showLogsCommand = async (
  _argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  console.log(`Bridge logs: ${readBridgeLogPath(commandScope.config.repoPath)}`);
};

export const showStatusCommand = async (
  _argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  console.log(createBridgeStatus(commandScope));
};

export const showStatuslineCommand = async (
  _argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  console.log(createBridgeStatus(commandScope));
};

export const clearChatCommand = async (
  _argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  commandScope.clearMessages?.();
  console.log(
    "Cleared terminal chat view. Browser conversation, context estimate, and local session logs are unchanged.",
  );
};

export const requestDiffCommand = async (
  _argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  await commandScope.sendMessage("Show me the current git diff for the repository.");
};

export const exitBridgeCommand = async (
  _argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  if (commandScope.shutdown) {
    await commandScope.shutdown();
    return;
  }

  console.log("Shutting down...");
};

export const printCustomCommands = async (commandScope: CommandSession): Promise<void> => {
  const custom = await loadCustomCommands({ repoRoot: commandScope.config.repoPath });

  const isCustomEmpty = custom.length === 0;
  if (isCustomEmpty) return;

  console.log(CUSTOM_COMMANDS_HEADING);
  for (const cmd of custom) {
    const description = cmd.description == null ? `${cmd.source} command` : cmd.description;
    console.log(`  /${cmd.name.padEnd(16)} ${description}`);
  }
};

export const listCustomCommandsCommand = async (
  _argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  const custom = await loadCustomCommands({ repoRoot: commandScope.config.repoPath });

  const isCustomEmpty = custom.length === 0;
  if (isCustomEmpty) {
    console.log("No custom commands found in .bridge/commands or ~/.ai-browser-bridge/commands.");
    return;
  }

  console.log(CUSTOM_COMMANDS_HEADING);
  for (const command of custom) {
    const description =
      command.description == null ? `${command.source} command` : command.description;
    console.log(`  /${command.name.padEnd(16)} ${description}`);
  }
  console.log("");
};
