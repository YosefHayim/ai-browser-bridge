import type { CommandSession } from "@/domain/command-types.ts";
import type { ConnectorSetupReport } from "@/domain/connector-types.ts";
import { cleanPermissionMode, PERMISSION_MODES } from "@/domain/permissions.ts";
import { readProvider, readProviderIdFrom } from "@/providers/providers.ts";
import { LIST_SEPARATOR, NEWLINE } from "@/terminal/cli-text.ts";
import {
  createProjectTaskPromptWithInstructions,
  readMcpConnectorUrl,
} from "@/terminal/project-task-prompt.ts";
import { readProviderDisplayName } from "@/terminal/provider-label.ts";
import { toolRegistry } from "@/tools/mcp-server.ts";
import { loadProjectInstructions } from "@/user-config/project-instructions.ts";
import {
  readStatusConnectorLabel,
  readStatusPermissionLabel,
  readStatusToolCallCount,
  readStatusTunnelLabel,
} from "./session-commands.ts";

const MCP_DIAGNOSTICS_HEADING = "MCP bridge diagnostics:";

const createMcpDiagnostics = (commandScope: CommandSession): string => {
  const toolCallCount = readStatusToolCallCount(commandScope);

  return [
    MCP_DIAGNOSTICS_HEADING,
    `Local server: http://localhost:${commandScope.config.mcpPort}`,
    `Tunnel: ${readStatusTunnelLabel(commandScope)}`,
    `Connector: ${readStatusConnectorLabel(commandScope)}`,
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
};

const readMcpToolCallStatusLabel = (toolCallCount: number): string => {
  const hasToolCalls = toolCallCount > 0;
  if (hasToolCalls) return "MCP tool calls observed in this bridge session.";

  return "No MCP tool calls observed yet; the current ChatGPT chat may not have the connector enabled.";
};

const createConnectorSetupReport = (report: ConnectorSetupReport): string => {
  const isStepsNotEmpty = report.steps.length > 0;
  const isWarningsNotEmpty = report.warnings.length > 0;

  return [
    "",
    "Connector setup result:",
    `URL: ${report.connectorUrl}`,
    `Submitted: ${report.completed ? "yes" : "no"}`,
    ...(isStepsNotEmpty ? ["", "Steps:", ...report.steps.map((step) => `- ${step}`)] : []),
    ...(isWarningsNotEmpty
      ? ["", "Needs manual attention:", ...report.warnings.map((warning) => `- ${warning}`)]
      : []),
    "",
    "Automatic startup handles this on each restart when the browser is connected. Manual fallback: ChatGPT Settings -> Apps -> Advanced settings -> Create app, paste the Connector URL, choose no authentication, then enable it in Developer Mode for this chat.",
  ].join(NEWLINE);
};

const isProviderMissingMcpConnector = (commandScope: CommandSession): boolean => {
  return !readProvider(commandScope.config.provider).supportsMcpConnector;
};

export const showMcpCommand = async (
  _argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  const isMcpConnectorMissing = isProviderMissingMcpConnector(commandScope);
  if (isMcpConnectorMissing) {
    printNoMcpDiagnostics(commandScope);
    return;
  }

  console.log(createMcpDiagnostics(commandScope));
};

const printNoMcpDiagnostics = (commandScope: CommandSession): void => {
  const label = readProviderDisplayName(readProviderIdFrom(commandScope.config.provider));

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
};

export const openConnectorCommand = async (
  _argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  const isMcpConnectorMissing = isProviderMissingMcpConnector(commandScope);
  if (isMcpConnectorMissing) {
    printNoConnectorWarning(commandScope);
    return;
  }

  const connector = readMcpConnectorUrl(commandScope.config.tunnelUrl);

  const isConnectorEmpty = !connector;
  if (isConnectorEmpty) {
    printMissingConnectorUrl(commandScope);
    return;
  }

  await openConnectorSetup({ connector, ctx: commandScope });
};

const printNoConnectorWarning = (commandScope: CommandSession): void => {
  const label = readProviderDisplayName(readProviderIdFrom(commandScope.config.provider));
  console.log(
    `${label} web has no custom MCP connector UI. Use @file mentions for read-only repo context, or run with --provider chatgpt, claude, or grok for full MCP tools.`,
  );
};

const printMissingConnectorUrl = (commandScope: CommandSession): void => {
  console.log(
    [
      "No public connector URL is available.",
      `Local MCP server: http://localhost:${commandScope.config.mcpPort}`,
      "ChatGPT cannot normally reach localhost from the browser connector.",
      "Restart the bridge and fix Cloudflare Tunnel, then run /connector again.",
    ].join(NEWLINE),
  );
};

const openConnectorSetup = async (parameters: {
  connector: string;
  ctx: CommandSession;
}): Promise<void> => {
  console.log(createMcpDiagnostics(parameters.ctx));

  if (!parameters.ctx.orchestrator.openConnectorSetup) {
    console.log(
      "\nBrowser setup automation is unavailable. Open ChatGPT Settings -> Apps -> Advanced settings -> Create app and paste the Connector URL.",
    );
    return;
  }

  const setupReport = await parameters.ctx.orchestrator.openConnectorSetup({
    connectorUrl: parameters.connector,
  });
  console.log(createConnectorSetupReport(setupReport));
};

export const runPermissionsCommand = async (
  argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  const next = argumentList.trim();

  const isNextEmpty = !next;
  if (isNextEmpty) {
    printPermissionModes(commandScope);
    return;
  }

  await setPermissionMode({ next, ctx: commandScope });
};

const printPermissionModes = (commandScope: CommandSession): void => {
  console.log(`Permission mode: ${readStatusPermissionLabel(commandScope)}`);
  console.log(`Available: ${PERMISSION_MODES.join(LIST_SEPARATOR)}`);
};

const setPermissionMode = async (parameters: {
  next: string;
  ctx: CommandSession;
}): Promise<void> => {
  const mode = cleanPermissionMode(parameters.next);

  const isNextModeDifferent = mode !== parameters.next;
  if (isNextModeDifferent) {
    console.log(
      `Unknown permission mode "${parameters.next}". Available: ${PERMISSION_MODES.join(LIST_SEPARATOR)}`,
    );
    return;
  }

  await parameters.ctx.permission?.setMode(mode);
  parameters.ctx.config.permissionMode = mode;
  console.log(`Permission mode set to ${mode}.`);
};

export const runTaskCommand = async (
  argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  const task = argumentList.trim();

  const isTaskEmpty = task === "";
  if (isTaskEmpty) {
    console.log("Usage: /task <project task>");
    return;
  }

  const isMcpConnectorMissing = isProviderMissingMcpConnector(commandScope);
  if (isMcpConnectorMissing) {
    printNoMcpTaskWarning(commandScope);
    return;
  }

  const instructions = await loadProjectInstructions(commandScope.config.repoPath);
  await commandScope.sendMessage(
    createProjectTaskPromptWithInstructions(task, commandScope, instructions.promptText),
  );
};

const printNoMcpTaskWarning = (commandScope: CommandSession): void => {
  const label = readProviderDisplayName(readProviderIdFrom(commandScope.config.provider));
  console.log(
    `${label} web does not support MCP connectors. /task needs live repo tools — use --provider chatgpt, claude, or grok, or send a normal prompt with @file mentions.`,
  );
};

export const runReviewCommand = async (
  argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  const scope = argumentList.trim() || "working";

  await commandScope.sendMessage(
    [
      "Review the local repository changes with a code-review stance.",
      "Prioritize bugs, regressions, security risks, and missing tests.",
      "Use the MCP tools to inspect the repo and diff before making claims.",
      `Review scope: ${scope}`,
    ].join(NEWLINE),
  );
};
