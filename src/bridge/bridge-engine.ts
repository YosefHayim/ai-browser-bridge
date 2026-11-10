import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { BrowserSession } from "@/browser/browser-session.ts";
import { type CloudflareTunnel, startCloudflareTunnel } from "@/cloudflare-tunnel.ts";
import { DEFAULT_MCP_PORT, DEFAULT_PERMISSION_MODE } from "@/config";
import type { BridgeSettings } from "@/domain/bridge-types.ts";
import type { Message } from "@/domain/message-types.ts";
import { cleanPermissionMode, type PermissionMode } from "@/domain/permissions.ts";
import { readProvider, readProviderIdFrom } from "@/providers/providers.ts";
import { expandFileMentions } from "@/store/file-mentions.ts";
import { appendBridgeLog } from "@/store/logging.ts";
import {
  ensureBridgeDirectory,
  readAttachmentManifestsDirectory,
  readDownloadsDirectory,
  readRepositoryRoot,
  readSessionsDirectory,
} from "@/store/paths.ts";
import {
  appendSessionEvent,
  createSession,
  MESSAGE_EVENT_TYPE,
  updateSession,
} from "@/store/session-store.ts";
import { type McpServerHandle, type McpToolAction, startMcpServer } from "@/tools/mcp-server.ts";
import { loadHooksSettings, runHooks } from "@/user-config/hooks.ts";
import type {
  AskEngineDetails,
  EngineAssembly,
  EngineRuntimeStatus,
  ShutdownEngineDetails,
  StartEngineSettings,
} from "./bridge-engine-types.ts";
import { TokenCounter } from "./context-counter.ts";
import { loadSettings, saveSettings } from "./load-config.ts";
import { Orchestrator, readErrorMessage } from "./orchestrator.ts";

const SESSION_START_HOOK_EVENT = "SessionStart";

const readMcpConnectorUrl = (tunnelUrl: string): string => {
  return `${tunnelUrl.replace(/\/+$/, "")}/mcp`;
};

const readCurrentGitBranch = (repoPath: string): Promise<string | null> => {
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
};

const writeDefaultEngineLog = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

const readEngineLog = (settings: StartEngineSettings): ((line: string) => void) => {
  return settings.log ?? writeDefaultEngineLog;
};

const logHookWarnings = (errors: string[], log: (line: string) => void): void => {
  for (const error of errors) log(`Hooks warning: ${error}`);
};

const readPermissionModeFromSettings = (
  permissionMode: BridgeSettings["permissionMode"],
): PermissionMode => {
  const isPermissionModeMissing = permissionMode == null;
  if (isPermissionModeMissing) {
    return cleanPermissionMode(DEFAULT_PERMISSION_MODE);
  }

  return cleanPermissionMode(permissionMode);
};

const readEngineSettings = async (settings: StartEngineSettings): Promise<BridgeSettings> => {
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
};

const persistEngineSettings = async (settings: BridgeSettings): Promise<void> => {
  await ensureBridgeDirectory(settings.repoPath);
  await saveSettings(settings);
};

type EngineFeatureFlags = {
  withTools: boolean;
  withTunnel: boolean;
  withBrowser: boolean | undefined;
};

const readEngineFeatureFlags = (
  settings: StartEngineSettings,
  supportsMcpConnector: boolean,
): EngineFeatureFlags => {
  const isPersistDisabled = settings.persist === false;
  const defaultWithTools = !isPersistDisabled;
  const withToolsSetting = settings.withTools ?? defaultWithTools;
  const withTools = withToolsSetting && supportsMcpConnector;

  const withTunnelSetting = settings.withTunnel ?? withTools;
  const withTunnel = withTunnelSetting && supportsMcpConnector;

  return { withTools, withTunnel, withBrowser: settings.withBrowser };
};

const isPersistenceEnabled = (
  settings: StartEngineSettings,
  flags: EngineFeatureFlags,
): boolean => {
  const hasSettingsPersist = settings.persist != null;
  if (hasSettingsPersist) {
    const isPersistRequested = settings.persist;
    if (isPersistRequested) return true;

    return flags.withTools || flags.withTunnel;
  }

  return true;
};

const runSessionHooks = async (
  event: "SessionStart" | "UserPromptSubmit" | "SessionEnd",
  hooks: Awaited<ReturnType<typeof loadHooksSettings>>["hooks"],
): Promise<void> => {
  await Promise.allSettled([runHooks(event, hooks)]);
};

const initEngineRuntime = async (
  settings: BridgeSettings,
  hooksSettings: Awaited<ReturnType<typeof loadHooksSettings>>,
  persistent: boolean,
): Promise<EngineRuntimeStatus & { branch?: string }> => {
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
};

const saveToolAction = async (details: {
  toolActions: McpToolAction[];
  getSessionId: () => string;
  sessionStore: { baseDir: string };
  action: McpToolAction;
}): Promise<void> => {
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
};

const startMcpIfNeeded = async (details: {
  config: BridgeSettings;
  flags: EngineFeatureFlags;
  hooksConfig: Awaited<ReturnType<typeof loadHooksSettings>>;
  runtime: EngineRuntimeStatus;
  toolActions: McpToolAction[];
  log: (line: string) => void;
}): Promise<McpServerHandle | null> => {
  const isNotFlagsWithTools = !details.flags.withTools;
  if (isNotFlagsWithTools) return null;

  const sessionStore = { baseDir: readSessionsDirectory(details.config.repoPath) };
  const getSessionId = () => details.runtime.sessionId;
  const mcpServer = await startMcpServer(details.config.repoPath, details.config.mcpPort, {
    getPermissionMode: () => details.runtime.permissionMode,
    hooks: details.hooksConfig.hooks,
    onToolAction: (action) =>
      saveToolAction({ toolActions: details.toolActions, getSessionId, sessionStore, action }),
  });
  details.log(`MCP:     ${mcpServer.url}`);
  return mcpServer;
};

type EngineBootStatus = {
  config: BridgeSettings;
  hooksConfig: Awaited<ReturnType<typeof loadHooksSettings>>;
  runtime: EngineRuntimeStatus & { branch?: string };
  flags: EngineFeatureFlags;
  toolActions: McpToolAction[];
  mcpServer: McpServerHandle | null;
  log: (line: string) => void;
  getSessionId: () => string;
  persistent: boolean;
};

const loadEngineBootStatus = async (settings: StartEngineSettings): Promise<EngineBootStatus> => {
  const log = readEngineLog(settings);
  const engineSettings = await readEngineSettings(settings);
  const flags = readEngineFeatureFlags(
    settings,
    readProvider(engineSettings.provider).supportsMcpConnector,
  );

  const persistent = isPersistenceEnabled(settings, flags);

  const isPersistentSession = persistent;
  if (isPersistentSession) await persistEngineSettings(engineSettings);

  const hooksSettings = await loadHooksSettings({ repoRoot: engineSettings.repoPath });
  logHookWarnings(hooksSettings.errors, log);
  const runtime = await initEngineRuntime(engineSettings, hooksSettings, persistent);
  const toolActions: McpToolAction[] = [];
  const mcpServer = await startMcpIfNeeded({
    config: engineSettings,
    flags,
    hooksConfig: hooksSettings,
    runtime,
    toolActions,
    log,
  });
  return {
    config: engineSettings,
    hooksConfig: hooksSettings,
    runtime,
    flags,
    toolActions,
    mcpServer,
    log,
    getSessionId: () => runtime.sessionId,
    persistent,
  };
};

const persistMessageEvent = (details: {
  config: BridgeSettings;
  getSessionId: () => string;
  message: Message;
  sessionStore: { baseDir: string };
}): void => {
  const sessionId = details.getSessionId();
  const logType = `chatgpt_${details.message.role}_message`;

  void Promise.allSettled([
    appendBridgeLog({
      repoPath: details.config.repoPath,
      type: logType,
      data: { content: details.message.content },
    }),
    appendSessionEvent(
      sessionId,
      {
        type: MESSAGE_EVENT_TYPE,
        role: details.message.role,
        content: details.message.content,
        data: { messageId: details.message.id },
      },
      details.sessionStore,
    ),
  ]);
};

const persistModelChange = (details: {
  config: BridgeSettings;
  getSessionId: () => string;
  model: string;
  contextLimit: number;
  sessionStore: { baseDir: string };
}): void => {
  const sessionId = details.getSessionId();

  void Promise.allSettled([
    saveSettings(details.config),
    updateSession(
      sessionId,
      { model: details.model, contextLimit: details.contextLimit },
      details.sessionStore,
    ),
  ]);
};

const attachPersistenceListener = (details: {
  orchestrator: Orchestrator;
  counter: TokenCounter;
  config: BridgeSettings;
  getSessionId: () => string;
  persistent: boolean;
}): void => {
  const sessionStore = { baseDir: readSessionsDirectory(details.config.repoPath) };
  details.orchestrator.subscribe((event) => {
    const isEventTypeMessage = event.type === MESSAGE_EVENT_TYPE;
    if (isEventTypeMessage) {
      details.counter.add(event.message);

      const isNotPersistent = !details.persistent;
      if (isNotPersistent) return;

      persistMessageEvent({
        config: details.config,
        getSessionId: details.getSessionId,
        message: event.message,
        sessionStore,
      });
      return;
    }

    const isEventTypeConversationSynced = event.type === "conversation_synced";
    if (isEventTypeConversationSynced) {
      details.counter.reset();
      for (const message of event.messages) details.counter.add(message);
      return;
    }

    const isEventTypeReset = event.type === "reset";
    if (isEventTypeReset) {
      details.counter.reset();
      return;
    }

    const isEventTypeModelChanged = event.type === "model_changed";
    if (isEventTypeModelChanged) {
      details.counter.setModel(event.model);
      details.config.model = event.model;
      details.config.contextLimit = event.contextLimit;

      const isSessionTransient = !details.persistent;
      if (isSessionTransient) return;

      persistModelChange({
        config: details.config,
        getSessionId: details.getSessionId,
        model: event.model,
        contextLimit: event.contextLimit,
        sessionStore,
      });
    }
  });
};

const startTunnel = async (details: {
  config: BridgeSettings;
  sessionId: string;
  log: (line: string) => void;
  persistent: boolean;
}): Promise<{ tunnel: CloudflareTunnel | null; connectorUrl: string }> => {
  try {
    const tunnel = await startCloudflareTunnel(details.config.mcpPort);
    const tunnelUrl = tunnel.publicUrl;
    details.config.tunnelUrl = tunnelUrl;
    const connectorUrl = readMcpConnectorUrl(tunnelUrl);

    const isSessionPersistent = details.persistent;
    if (isSessionPersistent) {
      await Promise.allSettled([
        updateSession(
          details.sessionId,
          { tunnelUrl },
          { baseDir: readSessionsDirectory(details.config.repoPath) },
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
};

const logConnectorSetupNeedsAttention = (details: {
  log: (line: string) => void;
  reason: string;
}): void => {
  details.log(`Connector setup: needs attention (${details.reason}).`);
};

const finishConnectorSetup = async (details: {
  orchestrator: Orchestrator;
  connectorUrl: string;
  log: (line: string) => void;
}): Promise<void> => {
  const provider = details.orchestrator.browserProvider;
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
};

const startOrchestrator = async (details: {
  orchestrator: Orchestrator;
  log: (line: string) => void;
}): Promise<void> => {
  try {
    await details.orchestrator.start();
  } catch (error) {
    const reason = readErrorMessage(error);
    details.log(`Bridge start failed (${reason}).`);
  }
};

const connectBrowser = async (details: {
  orchestrator: Orchestrator;
  connectorUrl: string;
  config: BridgeSettings;
  log: (line: string) => void;
  debugPort?: number;
  profileRoot: string | null;
}): Promise<BrowserSession | null> => {
  const providerId = readProviderIdFrom(details.config.provider);
  let browser: BrowserSession | null = new BrowserSession(providerId, {
    debugPort: details.debugPort,
    profileRoot: details.profileRoot,
  });
  try {
    const provider = readProvider(providerId);
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
    const isErrorObject = error instanceof Error;
    const message = isErrorObject ? error.message : String(error);
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
};

type BootTunnel = { tunnel: CloudflareTunnel | null; connectorUrl: string };

const readBootTunnel = async (boot: EngineBootStatus): Promise<BootTunnel> => {
  const isTunnelWanted = boot.flags.withTunnel;
  if (isTunnelWanted) {
    return startTunnel({
      config: boot.config,
      sessionId: boot.runtime.sessionId,
      log: boot.log,
      persistent: boot.persistent,
    });
  }

  return { tunnel: null, connectorUrl: "" };
};

const connectBootBrowser = async (details: {
  boot: EngineBootStatus;
  orchestrator: Orchestrator;
  connectorUrl: string;
  debugPort?: number;
  profileRoot: string | null;
}): Promise<BrowserSession | null> => {
  const isBrowserSkipped = details.boot.flags.withBrowser === false;
  if (isBrowserSkipped) return null;

  return connectBrowser({
    orchestrator: details.orchestrator,
    connectorUrl: details.connectorUrl,
    config: details.boot.config,
    log: details.boot.log,
    debugPort: details.debugPort,
    profileRoot: details.profileRoot,
  });
};

const bootEngine = async (settings: StartEngineSettings): Promise<EngineAssembly> => {
  const boot = await loadEngineBootStatus(settings);
  const isBootPersistent = boot.persistent;
  const manifestRoot = isBootPersistent
    ? readDownloadsDirectory(boot.config.repoPath)
    : readAttachmentManifestsDirectory();
  const orchestrator = new Orchestrator(boot.config, undefined, { manifestRoot });
  const counter = new TokenCounter(boot.config.contextLimit, boot.config.model);
  attachPersistenceListener({
    orchestrator,
    counter,
    config: boot.config,
    getSessionId: boot.getSessionId,
    persistent: boot.persistent,
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
    config: boot.config,
    orchestrator,
    counter,
    browser,
    mcpServer: boot.mcpServer,
    tunnel: tunnel.tunnel,
    connectorUrl: tunnel.connectorUrl,
    hooksConfig: boot.hooksConfig,
    toolActions: boot.toolActions,
    branch: boot.runtime.branch,
    runtime: { sessionId: boot.runtime.sessionId, permissionMode: boot.runtime.permissionMode },
    persistent: boot.persistent,
  };
};

export class BridgeEngine {
  readonly config: BridgeSettings;
  readonly counter: TokenCounter;
  readonly browser: BrowserSession | null;
  readonly connectorUrl: string;
  readonly hooksConfig: EngineAssembly["hooksConfig"];
  readonly toolActions: McpToolAction[];
  readonly branch?: string;

  private readonly orchestrator: Orchestrator;
  private readonly mcpServer: McpServerHandle | null;
  private readonly tunnel: CloudflareTunnel | null;
  private runtime: EngineRuntimeStatus;

  private constructor(private readonly assembly: EngineAssembly) {
    this.config = assembly.config;
    this.orchestrator = assembly.orchestrator;
    this.counter = assembly.counter;
    this.browser = assembly.browser;
    this.mcpServer = assembly.mcpServer;
    this.tunnel = assembly.tunnel;
    this.connectorUrl = assembly.connectorUrl;
    this.hooksConfig = assembly.hooksConfig;
    this.toolActions = assembly.toolActions;
    this.branch = assembly.branch;
    this.runtime = { ...assembly.runtime };
  }

  static async start(settings: StartEngineSettings): Promise<BridgeEngine> {
    const bootedEngineParts = await bootEngine(settings);
    return new BridgeEngine(bootedEngineParts);
  }

  getOrchestrator(): Orchestrator {
    return this.orchestrator;
  }

  async ask(details: AskEngineDetails): Promise<Message | null> {
    await runSessionHooks("UserPromptSubmit", this.hooksConfig.hooks);

    const expanded = await expandFileMentions(details.content, this.config.repoPath);

    return this.orchestrator.sendPrompt({
      content: expanded.prompt,
      timeoutMilliseconds: details.timeoutMilliseconds,
      expectImages: details.expectImages,
    });
  }

  async shutDown(details: ShutdownEngineDetails = {}): Promise<void> {
    await Promise.allSettled([
      this.orchestrator.stopReply(),
      runHooks("SessionEnd", this.hooksConfig.hooks),
    ]);
    this.tunnel?.stop();
    this.mcpServer?.close();

    const isBrowserMissing = this.browser == null;
    if (isBrowserMissing) return;

    await Promise.allSettled([this.browser.closeOwnTab()]);

    const isCloseBrowserSkipped = details.closeBrowser !== true;
    if (isCloseBrowserSkipped) return;

    await Promise.allSettled([this.browser.close()]);
  }

  get sessionId(): string {
    return this.runtime.sessionId;
  }

  set sessionId(id: string) {
    this.runtime.sessionId = id;
    this.assembly.runtime.sessionId = id;
  }

  get permissionMode(): PermissionMode {
    return this.runtime.permissionMode;
  }

  set permissionMode(mode: PermissionMode) {
    this.runtime.permissionMode = cleanPermissionMode(mode);
    this.assembly.runtime.permissionMode = this.runtime.permissionMode;
    this.config.permissionMode = this.runtime.permissionMode;

    const isNotAssemblyPersistent = !this.assembly.persistent;
    if (isNotAssemblyPersistent) return;

    void Promise.allSettled([saveSettings(this.config)]);
  }
}

export const startEngine = (settings: StartEngineSettings): Promise<BridgeEngine> => {
  return BridgeEngine.start(settings);
};
