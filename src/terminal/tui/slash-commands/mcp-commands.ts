import type { CommandSession } from "@/command-types.ts";
import type { ConnectorSetupReport } from "@/connector-types.ts";
import { cleanPermissionMode, PERMISSION_MODES } from "@/permissions.ts";
import { readProviderIdFrom, readProviderProfile } from "@/providers/providers.ts";
import { loadProjectInstructions } from "@/repo-files/project-instructions.ts";
import { toolRegistry } from "@/repo-tools-mcp/tool-registry.ts";
import { LIST_SEPARATOR, NEWLINE } from "@/terminal/cli/cli-text.ts";
import {
  createProjectTaskPromptWithInstructions,
  readMcpConnectorUrl,
} from "@/terminal/cli/project-task-prompt.ts";
import { readProviderDisplayName } from "@/terminal/cli/provider-label.ts";
import {
  readStatusConnectorLabel,
  readStatusPermissionLabel,
  readStatusToolCallCount,
  readStatusTunnelLabel,
} from "@/terminal/tui/slash-commands/session-commands.ts";

const MCP_DIAGNOSTICS_HEADING = "MCP bridge diagnostics:";

function createMcpDiagnostics(commandSession: CommandSession): string {
  const toolCallCount = readStatusToolCallCount(commandSession);

  return [
    MCP_DIAGNOSTICS_HEADING,
    `Local server: http://localhost:${commandSession.bridgeSettings.mcpPort}`,
    `Tunnel: ${readStatusTunnelLabel(commandSession)}`,
    `Connector: ${readStatusConnectorLabel(commandSession)}`,
    `Tools: ${[...toolRegistry.keys()].join(LIST_SEPARATOR)}`,
    `Tool calls observed this session: ${toolCallCount}`,
    `Status: ${readMcpToolCallStatusLabel(toolCallCount)}`,
    "",
    "If ChatGPT says it cannot access local files:",
    "1. Startup automatically syncs the current Connector URL into ChatGPT when browser automation is connected.",
    "2. Run /connector only to retry that browser setup flow after a UI drift or account permission issue.",
    "3. Ask explicitly: use the ai-browser-bridge connector; do not answer from memory.",
    "4. A reply mentioning /mnt/data, upload a zip, or paste tree/find output means ChatGPT is not using this local connector.",
  ].join(NEWLINE);
}

function readMcpToolCallStatusLabel(toolCallCount: number): string {
  const hasToolCalls = toolCallCount > 0;
  if (hasToolCalls) return "MCP tool calls observed in this bridge session.";

  return "No MCP tool calls observed yet; the current ChatGPT chat may not have the connector enabled.";
}

function createConnectorSetupReport(report: ConnectorSetupReport): string {
  const isStepsNotEmpty = report.steps.length > 0;
  const isWarningsNotEmpty = report.warnings.length > 0;

  const isCompleted = report.completed;
  return [
    "",
    "Connector setup result:",
    `URL: ${report.connectorUrl}`,
    `Submitted: ${isCompleted ? "yes" : "no"}`,
    ...(isStepsNotEmpty ? ["", "Steps:", ...report.steps.map((step) => `- ${step}`)] : []),
    ...(isWarningsNotEmpty
      ? ["", "Needs manual attention:", ...report.warnings.map((warning) => `- ${warning}`)]
      : []),
    "",
    "Automatic startup handles this on each restart when the browser is connected. Manual fallback: open chatgpt.com/plugins, click Add, then Add custom MCP server, paste the Connector URL, choose no authentication, then turn the plugin on in the chat from the composer's + menu.",
  ].join(NEWLINE);
}

function isProviderMissingMcpConnector(commandSession: CommandSession): boolean {
  return !readProviderProfile(readProviderIdFrom(commandSession.bridgeSettings.provider))
    .supportsMcpConnector;
}

export async function showMcpCommand(
  _argumentList: string,
  commandSession: CommandSession,
): Promise<void> {
  const isMcpConnectorMissing = isProviderMissingMcpConnector(commandSession);
  if (isMcpConnectorMissing) {
    printNoMcpDiagnostics(commandSession);
    return;
  }

  console.log(createMcpDiagnostics(commandSession));
}

function printNoMcpDiagnostics(commandSession: CommandSession): void {
  const label = readProviderDisplayName(readProviderIdFrom(commandSession.bridgeSettings.provider));

  console.log(
    [
      MCP_DIAGNOSTICS_HEADING,
      `Provider: ${label} web`,
      `Local MCP tools are not available in the ${label} web UI.`,
      "Use @file mentions to inline repo files into prompts.",
      "",
      "For full MCP tools, run with --provider chatgpt, claude, or grok.",
    ].join(NEWLINE),
  );
}

export async function openConnectorCommand(
  _argumentList: string,
  commandSession: CommandSession,
): Promise<void> {
  const isMcpConnectorMissing = isProviderMissingMcpConnector(commandSession);
  if (isMcpConnectorMissing) {
    printNoConnectorWarning(commandSession);
    return;
  }

  const connector = readMcpConnectorUrl(commandSession.bridgeSettings.tunnelUrl);

  const isConnectorEmpty = !connector;
  if (isConnectorEmpty) {
    printMissingConnectorUrl(commandSession);
    return;
  }

  await openConnectorSetup({ connector, commandSession: commandSession });
}

function printNoConnectorWarning(commandSession: CommandSession): void {
  const label = readProviderDisplayName(readProviderIdFrom(commandSession.bridgeSettings.provider));
  console.log(
    `${label} web has no custom MCP connector UI. Use @file mentions for read-only repo context, or run with --provider chatgpt, claude, or grok for full MCP tools.`,
  );
}

function printMissingConnectorUrl(commandSession: CommandSession): void {
  console.log(
    [
      "No public connector URL is available.",
      `Local MCP server: http://localhost:${commandSession.bridgeSettings.mcpPort}`,
      "ChatGPT cannot normally reach localhost from the browser connector.",
      "Restart the bridge and fix Cloudflare Tunnel, then run /connector again.",
    ].join(NEWLINE),
  );
}

async function openConnectorSetup(parameters: {
  connector: string;
  commandSession: CommandSession;
}): Promise<void> {
  console.log(createMcpDiagnostics(parameters.commandSession));

  const { orchestrator } = parameters.commandSession;
  const openSetupInBrowser = orchestrator.openConnectorSetup?.bind(orchestrator);
  const isOpenConnectorSetupMissing = openSetupInBrowser == null;

  if (isOpenConnectorSetupMissing) {
    console.log(
      "\nBrowser setup automation is unavailable. Open chatgpt.com/plugins, click Add, then Add custom MCP server, and paste the Connector URL.",
    );
    return;
  }

  const setupReport = await openSetupInBrowser({
    connectorUrl: parameters.connector,
  });
  console.log(createConnectorSetupReport(setupReport));
}

export async function runPermissionsCommand(
  argumentList: string,
  commandSession: CommandSession,
): Promise<void> {
  const next = argumentList.trim();

  const isNextEmpty = !next;
  if (isNextEmpty) {
    printPermissionModes(commandSession);
    return;
  }

  await setPermissionMode({ next, commandSession: commandSession });
}

function printPermissionModes(commandSession: CommandSession): void {
  console.log(`Permission mode: ${readStatusPermissionLabel(commandSession)}`);
  console.log(`Available: ${PERMISSION_MODES.join(LIST_SEPARATOR)}`);
}

async function setPermissionMode(parameters: {
  next: string;
  commandSession: CommandSession;
}): Promise<void> {
  const mode = cleanPermissionMode(parameters.next);

  const isNextModeDifferent = mode !== parameters.next;
  if (isNextModeDifferent) {
    console.log(
      `Unknown permission mode "${parameters.next}". Available: ${PERMISSION_MODES.join(LIST_SEPARATOR)}`,
    );
    return;
  }

  await parameters.commandSession.permission?.setMode(mode);
  parameters.commandSession.bridgeSettings.permissionMode = mode;
  console.log(`Permission mode set to ${mode}.`);
}

export async function runTaskCommand(
  argumentList: string,
  commandSession: CommandSession,
): Promise<void> {
  const task = argumentList.trim();

  const isTaskEmpty = task === "";
  if (isTaskEmpty) {
    console.log("Usage: /task <project task>");
    return;
  }

  const isMcpConnectorMissing = isProviderMissingMcpConnector(commandSession);
  if (isMcpConnectorMissing) {
    printNoMcpTaskWarning(commandSession);
    return;
  }

  const instructions = await loadProjectInstructions(commandSession.bridgeSettings.repoPath);
  await commandSession.sendMessage(
    createProjectTaskPromptWithInstructions(task, commandSession, instructions.promptText),
  );
}

function printNoMcpTaskWarning(commandSession: CommandSession): void {
  const label = readProviderDisplayName(readProviderIdFrom(commandSession.bridgeSettings.provider));
  console.log(
    `${label} web does not support MCP connectors. /task needs live repo tools — use --provider chatgpt, claude, or grok, or send a normal prompt with @file mentions.`,
  );
}

export async function runReviewCommand(
  argumentList: string,
  commandSession: CommandSession,
): Promise<void> {
  const scope = argumentList.trim() || "working";

  await commandSession.sendMessage(
    [
      "Review the local repository changes with a code-review stance.",
      "Prioritize bugs, regressions, security risks, and missing tests.",
      "Use the MCP tools to inspect the repo and diff before making claims.",
      `Review scope: ${scope}`,
    ].join(NEWLINE),
  );
}
