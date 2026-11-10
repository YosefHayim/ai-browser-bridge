import type { CommandSession } from "@/domain/command-types.ts";
import { readProviderIdFrom } from "@/providers/providers.ts";
import { readBridgeLogPath } from "@/store/logging.ts";
import { NEWLINE } from "@/terminal/cli-text.ts";
import { readMcpConnectorUrl } from "@/terminal/project-task-prompt.ts";
import { loadCustomCommands } from "@/user-config/custom-commands.ts";

const NONE_LABEL = "none";

const COMMAND_NAME_COLUMN_WIDTH = 16;

const CUSTOM_COMMANDS_HEADING = "\nCustom commands:\n";

const createBridgeStatus = (commandSession: CommandSession): string => {
  const provider = readProviderIdFrom(commandSession.config.provider);

  return [
    `Provider: ${provider}`,
    `Repo: ${commandSession.config.repoPath}`,
    `Branch: ${readStatusBranchLabel(commandSession)}`,
    `Session: ${readStatusSessionLabel(commandSession)}`,
    `Model: ${commandSession.counter.modelLabel}`,
    `Context: ${commandSession.counter.summary}`,
    `Permission: ${readStatusPermissionLabel(commandSession)}`,
    `Tool calls: ${readStatusToolCallCount(commandSession)}`,
    `Tunnel: ${readStatusTunnelLabel(commandSession)}`,
    `Connector: ${readStatusConnectorLabel(commandSession)}`,
  ].join(NEWLINE);
};

const readStatusBranchLabel = (commandSession: CommandSession): string => {
  const branch = commandSession.statusline?.branch;

  const isBranchBlank = branch == null || branch === "";
  if (isBranchBlank) return "unknown";

  return branch;
};

const readStatusSessionLabel = (commandSession: CommandSession): string => {
  const sessionId = commandSession.session?.getId();

  const isSessionIdBlank = sessionId == null || sessionId === "";
  if (isSessionIdBlank) return NONE_LABEL;

  return sessionId;
};

export const readStatusPermissionLabel = (commandSession: CommandSession): string => {
  const liveMode = commandSession.permission?.getMode();

  const hasLiveMode = liveMode != null;
  if (hasLiveMode) return liveMode;

  const configuredMode = commandSession.config.permissionMode;
  const isConfiguredModeGiven = configuredMode != null;
  if (isConfiguredModeGiven) return configuredMode;

  return "auto";
};

export const readStatusToolCallCount = (commandSession: CommandSession): number => {
  const liveCount = commandSession.statusline?.toolCallCount();

  const hasLiveCount = liveCount != null;
  if (hasLiveCount) return liveCount;

  return 0;
};

export const readStatusTunnelLabel = (commandSession: CommandSession): string => {
  const tunnelUrl = commandSession.config.tunnelUrl;
  const isTunnelUrlMissing = tunnelUrl == null || tunnelUrl === "";
  if (isTunnelUrlMissing) return NONE_LABEL;

  return tunnelUrl;
};

export const readStatusConnectorLabel = (commandSession: CommandSession): string => {
  const connector = readMcpConnectorUrl(commandSession.config.tunnelUrl);

  const isConnectorMissing = connector == null;
  if (isConnectorMissing) return NONE_LABEL;

  return connector;
};

export const runNewCommand = async (
  _argumentList: string,
  commandSession: CommandSession,
): Promise<void> => {
  await commandSession.orchestrator.openNewConversation();
  console.log("Started new conversation.");
};

export const stopReplyCommand = async (
  _argumentList: string,
  commandSession: CommandSession,
): Promise<void> => {
  const isStopped = await commandSession.orchestrator.stopReply();
  console.log(isStopped ? "Stopped active response." : "No active response to stop.");
};

export const requestCompactCommand = async (
  _argumentList: string,
  commandSession: CommandSession,
): Promise<void> => {
  await commandSession.sendMessage(
    "Summarize our progress so far in a structured format: what we've done, what's in progress, what's next. Be concise.",
  );
  console.log(
    "Compaction summary requested. Start a new conversation to continue with that summary.",
  );
};

export const showLogsCommand = async (
  _argumentList: string,
  commandSession: CommandSession,
): Promise<void> => {
  console.log(`Bridge logs: ${readBridgeLogPath(commandSession.config.repoPath)}`);
};

export const showStatusCommand = async (
  _argumentList: string,
  commandSession: CommandSession,
): Promise<void> => {
  console.log(createBridgeStatus(commandSession));
};

export const showStatuslineCommand = async (
  _argumentList: string,
  commandSession: CommandSession,
): Promise<void> => {
  console.log(createBridgeStatus(commandSession));
};

export const clearChatCommand = async (
  _argumentList: string,
  commandSession: CommandSession,
): Promise<void> => {
  commandSession.clearMessages?.();
  console.log(
    "Cleared terminal chat view. Browser conversation, context estimate, and local session logs are unchanged.",
  );
};

export const requestDiffCommand = async (
  _argumentList: string,
  commandSession: CommandSession,
): Promise<void> => {
  await commandSession.sendMessage("Show me the current git diff for the repository.");
};

export const exitBridgeCommand = async (
  _argumentList: string,
  commandSession: CommandSession,
): Promise<void> => {
  const shutdown = commandSession.shutdown;
  const isShutdownFound = shutdown != null;
  if (isShutdownFound) {
    await shutdown();
    return;
  }

  console.log("Shutting down...");
};

export const printCustomCommands = async (commandSession: CommandSession): Promise<void> => {
  const custom = await loadCustomCommands({ repoRoot: commandSession.config.repoPath });

  const isCustomEmpty = custom.length === 0;
  if (isCustomEmpty) return;

  console.log(CUSTOM_COMMANDS_HEADING);
  for (const cmd of custom) {
    const description = cmd.description ?? `${cmd.source} command`;
    console.log(`  /${cmd.name.padEnd(COMMAND_NAME_COLUMN_WIDTH)} ${description}`);
  }
};

export const listCustomCommandsCommand = async (
  _argumentList: string,
  commandSession: CommandSession,
): Promise<void> => {
  const custom = await loadCustomCommands({ repoRoot: commandSession.config.repoPath });

  const isCustomEmpty = custom.length === 0;
  if (isCustomEmpty) {
    console.log("No custom commands found in .bridge/commands or ~/.ai-browser-bridge/commands.");
    return;
  }

  console.log(CUSTOM_COMMANDS_HEADING);
  for (const command of custom) {
    const description = command.description ?? `${command.source} command`;
    console.log(`  /${command.name.padEnd(COMMAND_NAME_COLUMN_WIDTH)} ${description}`);
  }
  console.log("");
};
