import type { CommandSession } from "@/command-types.ts";
import { readProviderIdFrom } from "@/providers/providers.ts";
import { loadCustomCommands } from "@/repo-files/custom-commands.ts";
import { readBridgeLogPath } from "@/repo-files/logging.ts";
import { NEWLINE } from "@/terminal/cli/cli-text.ts";
import { readMcpConnectorUrl } from "@/terminal/cli/project-task-prompt.ts";

const NONE_LABEL = "none";

const COMMAND_NAME_COLUMN_WIDTH = 16;

const CUSTOM_COMMANDS_HEADING = "\nCustom commands:\n";

function createBridgeStatus(commandSession: CommandSession): string {
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
}

function readStatusBranchLabel(commandSession: CommandSession): string {
  const branch = commandSession.statusline?.branch;

  const isBranchBlank = branch == null || branch === "";
  if (isBranchBlank) return "unknown";

  return branch;
}

function readStatusSessionLabel(commandSession: CommandSession): string {
  const sessionId = commandSession.session?.getId();

  const isSessionIdBlank = sessionId == null || sessionId === "";
  if (isSessionIdBlank) return NONE_LABEL;

  return sessionId;
}

export function readStatusPermissionLabel(commandSession: CommandSession): string {
  const liveMode = commandSession.permission?.getMode();

  const hasLiveMode = liveMode != null;
  if (hasLiveMode) return liveMode;

  const configuredMode = commandSession.config.permissionMode;
  const isConfiguredModeGiven = configuredMode != null;
  if (isConfiguredModeGiven) return configuredMode;

  return "auto";
}

export function readStatusToolCallCount(commandSession: CommandSession): number {
  const liveCount = commandSession.statusline?.toolCallCount();

  const hasLiveCount = liveCount != null;
  if (hasLiveCount) return liveCount;

  return 0;
}

export function readStatusTunnelLabel(commandSession: CommandSession): string {
  const tunnelUrl = commandSession.config.tunnelUrl;
  const isTunnelUrlMissing = tunnelUrl == null || tunnelUrl === "";
  if (isTunnelUrlMissing) return NONE_LABEL;

  return tunnelUrl;
}

export function readStatusConnectorLabel(commandSession: CommandSession): string {
  const connector = readMcpConnectorUrl(commandSession.config.tunnelUrl);

  const isConnectorMissing = connector == null;
  if (isConnectorMissing) return NONE_LABEL;

  return connector;
}

export async function runNewCommand(
  _argumentList: string,
  commandSession: CommandSession,
): Promise<void> {
  await commandSession.orchestrator.openNewConversation();
  console.log("Started new conversation.");
}

export async function stopReplyCommand(
  _argumentList: string,
  commandSession: CommandSession,
): Promise<void> {
  const isStopped = await commandSession.orchestrator.stopReply();
  console.log(isStopped ? "Stopped active response." : "No active response to stop.");
}

export async function requestCompactCommand(
  _argumentList: string,
  commandSession: CommandSession,
): Promise<void> {
  await commandSession.sendMessage(
    "Summarize our progress so far in a structured format: what we've done, what's in progress, what's next. Be concise.",
  );
  console.log(
    "Compaction summary requested. Start a new conversation to continue with that summary.",
  );
}

export async function showLogsCommand(
  _argumentList: string,
  commandSession: CommandSession,
): Promise<void> {
  console.log(`Bridge logs: ${readBridgeLogPath(commandSession.config.repoPath)}`);
}

export async function showStatusCommand(
  _argumentList: string,
  commandSession: CommandSession,
): Promise<void> {
  console.log(createBridgeStatus(commandSession));
}

export async function showStatuslineCommand(
  _argumentList: string,
  commandSession: CommandSession,
): Promise<void> {
  console.log(createBridgeStatus(commandSession));
}

export async function clearChatCommand(
  _argumentList: string,
  commandSession: CommandSession,
): Promise<void> {
  commandSession.clearMessages?.();
  console.log(
    "Cleared terminal chat view. Browser conversation, context estimate, and local session logs are unchanged.",
  );
}

export async function requestDiffCommand(
  _argumentList: string,
  commandSession: CommandSession,
): Promise<void> {
  await commandSession.sendMessage("Show me the current git diff for the repository.");
}

export async function exitBridgeCommand(
  _argumentList: string,
  commandSession: CommandSession,
): Promise<void> {
  const shutdown = commandSession.shutdown;
  const isShutdownFound = shutdown != null;
  if (isShutdownFound) {
    await shutdown();
    return;
  }

  console.log("Shutting down...");
}

export async function printCustomCommands(commandSession: CommandSession): Promise<void> {
  const custom = await loadCustomCommands({ repoRoot: commandSession.config.repoPath });

  const isCustomEmpty = custom.length === 0;
  if (isCustomEmpty) return;

  console.log(CUSTOM_COMMANDS_HEADING);
  for (const cmd of custom) {
    const description = cmd.description ?? `${cmd.source} command`;
    console.log(`  /${cmd.name.padEnd(COMMAND_NAME_COLUMN_WIDTH)} ${description}`);
  }
}

export async function listCustomCommandsCommand(
  _argumentList: string,
  commandSession: CommandSession,
): Promise<void> {
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
}
