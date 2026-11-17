import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { DEFAULT_MCP_PORT, DEFAULT_PERMISSION_MODE } from "@/app-defaults.ts";
import type {
  EngineAssembly,
  EngineRuntimeStatus,
  StartEngineSettings,
} from "@/bridge-engine/bridge-engine-types.ts";
import { attachPersistenceListener } from "@/bridge-engine/engine-persistence.ts";
import { loadSettings, saveSettings } from "@/bridge-engine/repo-settings.ts";
import type { BridgeSettings } from "@/bridge-types.ts";
import { BrowserSession } from "@/browser/browser-session.ts";
import { loadHooksSettings, runHooks } from "@/hooks/hooks.ts";
import { TokenCounter } from "@/orchestrator/context-counter.ts";
import { Orchestrator } from "@/orchestrator/orchestrator.ts";
import { cleanPermissionMode, type PermissionMode } from "@/permissions.ts";
import { readProviderIdFrom, readProviderProfile } from "@/providers/providers.ts";
import { readErrorMessage } from "@/read-error-message.ts";
import {
  ensureBridgeDirectory,
  readAttachmentManifestsDirectory,
  readDownloadsDirectory,
  readRepositoryRoot,
  readSessionsDirectory,
} from "@/repo-files/paths.ts";
import {
  type McpServerHandle,
  type McpToolAction,
  startMcpServer,
} from "@/repo-tools-mcp/mcp-server.ts";
import { appendSessionEvent, createSession, updateSession } from "@/sessions/session-store.ts";
import { type CloudflareTunnel, startCloudflareTunnel } from "@/tunnel/cloudflare-tunnel.ts";

const SESSION_START_HOOK_EVENT = "SessionStart";

function readMcpConnectorUrl(tunnelUrl: string): string {
  return `${tunnelUrl.replace(/\/+$/, "")}/mcp`;
}

function readCurrentGitBranch(repoPath: string): Promise<string | null> {
  return new Promise((fulfill) => {
    execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoPath }, (error, stdout) => {
      const isGitFailed = error != null;
      if (isGitFailed) {
        fulfill(null);
        return;
      }

      const branch = stdout.trim();

      const isBranchEmpty = branch.length === 0;
      if (isBranchEmpty) {
        fulfill(null);
        return;
      }

      fulfill(branch);
    });
  });
}

function writeDefaultEngineLog(line: string): void {
  process.stderr.write(`${line}\n`);
}

function readEngineLog(settings: StartEngineSettings): (line: string) => void {
  return settings.log ?? writeDefaultEngineLog;
}

function logHookWarnings(errors: string[], log: (line: string) => void): void {
  for (const error of errors) log(`Hooks warning: ${error}`);
}

function readPermissionModeFromSettings(
  permissionMode: BridgeSettings["permissionMode"],
): PermissionMode {
  const isPermissionModeMissing = permissionMode == null;
  if (isPermissionModeMissing) {
    return cleanPermissionMode(DEFAULT_PERMISSION_MODE);
  }

  return cleanPermissionMode(permissionMode);
}

async function readEngineSettings(settings: StartEngineSettings): Promise<BridgeSettings> {
  const repoPath = readRepositoryRoot(settings.repoPath ?? process.cwd());
  const savedSettings = await loadSettings(repoPath);

  const provider = settings.provider ?? savedSettings.provider ?? "chatgpt";
  const mcpPort = settings.mcpPort ?? savedSettings.mcpPort ?? DEFAULT_MCP_PORT;

  const bridgeSettings = await loadSettings(repoPath, {
    provider,
    mcpPort,
  });
  bridgeSettings.provider = readProviderIdFrom(bridgeSettings.provider);
  bridgeSettings.permissionMode = readPermissionModeFromSettings(bridgeSettings.permissionMode);
  return bridgeSettings;
}

async function persistEngineSettings(settings: BridgeSettings): Promise<void> {
  await ensureBridgeDirectory(settings.repoPath);
  await saveSettings(settings);
}

type EngineFeatureFlags = {
  withTools: boolean;
  withTunnel: boolean;
  withBrowser: boolean | undefined;
};

function readEngineFeatureFlags(
  settings: StartEngineSettings,
  supportsMcpConnector: boolean,
): EngineFeatureFlags {
  const isPersistDisabled = settings.persist === false;
  const defaultWithTools = !isPersistDisabled;
  const withToolsSetting = settings.withTools ?? defaultWithTools;
  const withTools = withToolsSetting && supportsMcpConnector;

  const withTunnelSetting = settings.withTunnel ?? withTools;
  const withTunnel = withTunnelSetting && supportsMcpConnector;

  return { withTools, withTunnel, withBrowser: settings.withBrowser };
}

function isPersistenceEnabled(settings: StartEngineSettings, flags: EngineFeatureFlags): boolean {
  const hasSettingsPersist = settings.persist != null;
  if (hasSettingsPersist) {
    const isPersistRequested = settings.persist;
    if (isPersistRequested) return true;

    return flags.withTools || flags.withTunnel;
  }

  return true;
}

async function runSessionHooks(
  event: "SessionStart" | "UserPromptSubmit" | "SessionEnd",
  hooks: Awaited<ReturnType<typeof loadHooksSettings>>["hooks"],
): Promise<void> {
  await Promise.allSettled([runHooks(event, hooks)]);
}

async function initEngineRuntime(
  settings: BridgeSettings,
  hooksSettings: Awaited<ReturnType<typeof loadHooksSettings>>,
  persistent: boolean,
): Promise<EngineRuntimeStatus & { branch?: string }> {
  const branch = await readCurrentGitBranch(settings.repoPath);
  const isBranchMissing = branch == null;
  const optionalBranch = isBranchMissing ? {} : { branch };
  const permissionMode = readPermissionModeFromSettings(settings.permissionMode);

  const isNotPersistent = !persistent;
  if (isNotPersistent) {
    await runSessionHooks(SESSION_START_HOOK_EVENT, hooksSettings.hooks);
    return {
      sessionId: `stateless-${randomUUID()}`,
      permissionMode,
      ...optionalBranch,
    };
  }

  const sessionStore = { baseDir: readSessionsDirectory(settings.repoPath) };

  const model = settings.model ?? null;
  const tunnelUrl = settings.tunnelUrl ?? null;

  const session = await createSession(
    {
      repoPath: settings.repoPath,
      model,
      contextLimit: settings.contextLimit,
      tunnelUrl,
    },
    sessionStore,
  );
  await runSessionHooks(SESSION_START_HOOK_EVENT, hooksSettings.hooks);
  return {
    sessionId: session.metadata.id,
    permissionMode,
    ...optionalBranch,
  };
}

async function saveToolAction(details: {
  toolActions: McpToolAction[];
  getSessionId: () => string;
  sessionStore: { baseDir: string };
  action: McpToolAction;
}): Promise<void> {
  details.toolActions.push(details.action);

  const actionError = details.action.data?.error;
  const isActionErrorPresent = actionError != null;
  const actionErrorMessage = isActionErrorPresent ? String(actionError) : null;

  const sessionId = details.getSessionId();

  await Promise.allSettled([
    appendSessionEvent(
      sessionId,
      {
        type: "action",
        name: details.action.name,
        status: details.action.status,
        content: actionErrorMessage,
        data: details.action.data,
      },
      details.sessionStore,
    ),
  ]);
}

async function startMcpServerForTools(details: {
  bridgeSettings: BridgeSettings;
  flags: EngineFeatureFlags;
  hooksSettings: Awaited<ReturnType<typeof loadHooksSettings>>;
  runtime: EngineRuntimeStatus;
  toolActions: McpToolAction[];
  log: (line: string) => void;
}): Promise<McpServerHandle | null> {
  const isNotFlagsWithTools = !details.flags.withTools;
  if (isNotFlagsWithTools) return null;

  const sessionStore = { baseDir: readSessionsDirectory(details.bridgeSettings.repoPath) };
  function getSessionId() {
    return details.runtime.sessionId;
  }
  const mcpServer = await startMcpServer(
    details.bridgeSettings.repoPath,
    details.bridgeSettings.mcpPort,
    {
      getPermissionMode: () => details.runtime.permissionMode,
      hooks: details.hooksSettings.hooks,
      onToolAction: (action) =>
        saveToolAction({ toolActions: details.toolActions, getSessionId, sessionStore, action }),
    },
  );
  details.log(`MCP:     ${mcpServer.url}`);
  return mcpServer;
}

type EngineBootStatus = {
  bridgeSettings: BridgeSettings;
  hooksSettings: Awaited<ReturnType<typeof loadHooksSettings>>;
  runtime: EngineRuntimeStatus & { branch?: string };
  flags: EngineFeatureFlags;
  toolActions: McpToolAction[];
  mcpServer: McpServerHandle | null;
  log: (line: string) => void;
  getSessionId: () => string;
  persistent: boolean;
};

async function loadEngineBootStatus(settings: StartEngineSettings): Promise<EngineBootStatus> {
  const log = readEngineLog(settings);
  const engineSettings = await readEngineSettings(settings);
  const flags = readEngineFeatureFlags(
    settings,
    readProviderProfile(readProviderIdFrom(engineSettings.provider)).supportsMcpConnector,
  );

  const persistent = isPersistenceEnabled(settings, flags);

  const isPersistentSession = persistent;
  if (isPersistentSession) await persistEngineSettings(engineSettings);

  const hooksSettings = await loadHooksSettings({ repoRoot: engineSettings.repoPath });
  logHookWarnings(hooksSettings.errors, log);
  const runtime = await initEngineRuntime(engineSettings, hooksSettings, persistent);
  const toolActions: McpToolAction[] = [];
  const mcpServer = await startMcpServerForTools({
    bridgeSettings: engineSettings,
    flags,
    hooksSettings,
    runtime,
    toolActions,
    log,
  });
  return {
    bridgeSettings: engineSettings,
    hooksSettings,
    runtime,
    flags,
    toolActions,
    mcpServer,
    log,
    getSessionId: () => runtime.sessionId,
    persistent,
  };
}

async function startTunnel(details: {
  bridgeSettings: BridgeSettings;
  sessionId: string;
  log: (line: string) => void;
  persistent: boolean;
}): Promise<{ tunnel: CloudflareTunnel | null; connectorUrl: string }> {
  try {
    const tunnel = await startCloudflareTunnel(details.bridgeSettings.mcpPort);
    const tunnelUrl = tunnel.publicUrl;
    details.bridgeSettings.tunnelUrl = tunnelUrl;
    const connectorUrl = readMcpConnectorUrl(tunnelUrl);

    const isSessionPersistent = details.persistent;
    if (isSessionPersistent) {
      await Promise.allSettled([
        updateSession(
          details.sessionId,
          { tunnelUrl },
          { baseDir: readSessionsDirectory(details.bridgeSettings.repoPath) },
        ),
      ]);
    }

    details.log(`Tunnel:  ${tunnelUrl}`);
    details.log(`Connector: ${connectorUrl}`);
    return { tunnel, connectorUrl };
  } catch {
    details.log(
      "Tunnel: failed to start (cloudflared not installed?). MCP tools require a public URL the provider connector can reach.",
    );
    return { tunnel: null, connectorUrl: "" };
  }
}

function logConnectorSetupNeedsAttention(details: {
  log: (line: string) => void;
  reason: string;
}): void {
  details.log(`Connector setup: needs attention (${details.reason}).`);
}

async function finishConnectorSetup(details: {
  orchestrator: Orchestrator;
  connectorUrl: string;
  log: (line: string) => void;
}): Promise<void> {
  const provider = details.orchestrator.providerProfile;
  const isMcpConnectorMissing = !provider.supportsMcpConnector;
  if (isMcpConnectorMissing) {
    details.log(
      `Provider: ${provider.displayName} web has no MCP connector — @file mentions only.`,
    );
    return;
  }

  const hasConnectorUrl = details.connectorUrl !== "";
  if (!hasConnectorUrl) return;

  try {
    const connectorSetup = await details.orchestrator.openConnectorSetup({
      connectorUrl: details.connectorUrl,
      automatic: true,
    });

    const isConnectorSetupReady = connectorSetup.completed;
    if (isConnectorSetupReady) {
      details.log("Connector setup: ready");
      return;
    }

    logConnectorSetupNeedsAttention({
      log: details.log,
      reason: connectorSetup.warnings.join(" "),
    });
  } catch (error) {
    const reason = readErrorMessage(error);
    logConnectorSetupNeedsAttention({ log: details.log, reason });
  }
}

async function startOrchestrator(details: {
  orchestrator: Orchestrator;
  log: (line: string) => void;
}): Promise<void> {
  try {
    await details.orchestrator.start();
  } catch (error) {
    const reason = readErrorMessage(error);
    details.log(`Bridge start failed (${reason}).`);
  }
}

async function connectBrowser(details: {
  orchestrator: Orchestrator;
  connectorUrl: string;
  bridgeSettings: BridgeSettings;
  log: (line: string) => void;
  debugPort?: number;
  profileRoot: string | null;
}): Promise<BrowserSession | null> {
  const providerId = readProviderIdFrom(details.bridgeSettings.provider);
  let browser: BrowserSession | null = new BrowserSession(providerId, {
    debugPort: details.debugPort,
    profileRoot: details.profileRoot,
  });
  try {
    const provider = readProviderProfile(providerId);
    const page = await browser.launch();
    details.orchestrator.setPage(page);

    const isAttachedViaCdp = browser.attachedViaCdp.value;
    const isSpawnedNew = browser.spawnedNew.value;

    if (isAttachedViaCdp) {
      details.log("Browser: attached to Chrome on debug port (reusing your session).");
    } else if (isSpawnedNew) {
      details.log(
        `Browser: started Chrome for ${provider.displayName} on the debug port using the shared bridge profile.`,
      );
    } else {
      details.log("Browser: connected.");
    }
  } catch (error) {
    browser = null;
    const message = readErrorMessage(error);
    details.log(`Browser: failed to connect (${message}).`);
  }

  // The TUI draws now. Connector setup runs in its own tab in the background; only start holds prompts.
  void finishConnectorSetup({
    orchestrator: details.orchestrator,
    connectorUrl: details.connectorUrl,
    log: details.log,
  });
  details.orchestrator.holdPageUntil(
    startOrchestrator({ orchestrator: details.orchestrator, log: details.log }),
  );
  return browser;
}

type BootTunnel = { tunnel: CloudflareTunnel | null; connectorUrl: string };

async function readBootTunnel(boot: EngineBootStatus): Promise<BootTunnel> {
  const isTunnelWanted = boot.flags.withTunnel;
  if (isTunnelWanted) {
    return startTunnel({
      bridgeSettings: boot.bridgeSettings,
      sessionId: boot.runtime.sessionId,
      log: boot.log,
      persistent: boot.persistent,
    });
  }

  return { tunnel: null, connectorUrl: "" };
}

async function connectBootBrowser(details: {
  boot: EngineBootStatus;
  orchestrator: Orchestrator;
  connectorUrl: string;
  debugPort?: number;
  profileRoot: string | null;
}): Promise<BrowserSession | null> {
  const isBrowserSkipped = details.boot.flags.withBrowser === false;
  if (isBrowserSkipped) return null;

  return connectBrowser({
    orchestrator: details.orchestrator,
    connectorUrl: details.connectorUrl,
    bridgeSettings: details.boot.bridgeSettings,
    log: details.boot.log,
    debugPort: details.debugPort,
    profileRoot: details.profileRoot,
  });
}

export async function bootEngine(settings: StartEngineSettings): Promise<EngineAssembly> {
  const boot = await loadEngineBootStatus(settings);
  const isBootPersistent = boot.persistent;
  const manifestRoot = isBootPersistent
    ? readDownloadsDirectory(boot.bridgeSettings.repoPath)
    : readAttachmentManifestsDirectory();
  const orchestrator = new Orchestrator(boot.bridgeSettings, { manifestRoot });
  const counter = new TokenCounter(boot.bridgeSettings.contextLimit, boot.bridgeSettings.model);
  attachPersistenceListener({
    orchestrator,
    counter,
    bridgeSettings: boot.bridgeSettings,
    getSessionId: boot.getSessionId,
    persistent: boot.persistent,
    log: boot.log,
  });
  const tunnel = await readBootTunnel(boot);
  const browser = await connectBootBrowser({
    boot,
    orchestrator,
    connectorUrl: tunnel.connectorUrl,
    debugPort: settings.debugPort,
    profileRoot: settings.profileRoot,
  });

  return {
    bridgeSettings: boot.bridgeSettings,
    orchestrator,
    counter,
    browser,
    mcpServer: boot.mcpServer,
    tunnel: tunnel.tunnel,
    connectorUrl: tunnel.connectorUrl,
    hooksSettings: boot.hooksSettings,
    toolActions: boot.toolActions,
    branch: boot.runtime.branch,
    runtime: { sessionId: boot.runtime.sessionId, permissionMode: boot.runtime.permissionMode },
    persistent: boot.persistent,
  };
}
