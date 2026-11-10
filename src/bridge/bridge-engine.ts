import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { BrowserSession } from "@/browser/browser-session.ts";
import { CloudflareTunnel } from "@/cloudflare-tunnel.ts";
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
import { appendSessionEvent, createSession, updateSession } from "@/store/session-store.ts";
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
import { Orchestrator } from "./orchestrator.ts";

const readMcpConnectorUrl = (tunnelUrl: string): string => {
  return `${tunnelUrl.replace(/\/+$/, "")}/mcp`;
};

const readCurrentGitBranch = (repoPath: string): Promise<string | undefined> => {
  return new Promise((fulfill) => {
    execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoPath }, (error, stdout) => {
      if (error) {
        fulfill(undefined);
        return;
      }

      const branch = stdout.trim();

      const isBranchEmpty = branch.length === 0;
      if (isBranchEmpty) {
        fulfill(undefined);
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
  if (settings.log != null) return settings.log;

  return writeDefaultEngineLog;
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
  const repoPath = readRepositoryRoot(settings.repoPath);
  const savedSettings = await loadSettings(repoPath);

  let provider = settings.provider;

  const isProviderMissing = provider == null;
  if (isProviderMissing) provider = savedSettings.provider;

  if (provider == null) provider = "chatgpt";

  let mcpPort = settings.mcpPort;

  const isMcpPortMissing = mcpPort == null;
  if (isMcpPortMissing) mcpPort = savedSettings.mcpPort;

  if (mcpPort == null) mcpPort = DEFAULT_MCP_PORT;

  const bridgeSettings = await loadSettings(repoPath, {
    provider,
    mcpPort,
    tunnelUrl: undefined,
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
  let defaultWithTools = true;

  if (settings.persist === false) defaultWithTools = false;

  let withTools = defaultWithTools;
  if (settings.withTools != null) withTools = settings.withTools;

  withTools = withTools && supportsMcpConnector;

  let withTunnel = withTools;
  if (settings.withTunnel != null) withTunnel = settings.withTunnel;

  withTunnel = withTunnel && supportsMcpConnector;

  return { withTools, withTunnel, withBrowser: settings.withBrowser };
};

const isPersistenceEnabled = (
  settings: StartEngineSettings,
  flags: EngineFeatureFlags,
): boolean => {
  if (settings.persist != null) {
    if (settings.persist) return true;

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
  const permissionMode = readPermissionModeFromSettings(settings.permissionMode);

  const isNotPersistent = !persistent;
  if (isNotPersistent) {
    await runSessionHooks("SessionStart", hooksSettings.hooks);
    return {
      sessionId: `stateless-${randomUUID()}`,
      permissionMode,
      branch,
    };
  }

  const sessionStore = { baseDir: readSessionsDirectory(settings.repoPath) };

  let model: string | null = null;
  if (settings.model != null) model = settings.model;

  let tunnelUrl: string | null = null;
  if (settings.tunnelUrl != null) tunnelUrl = settings.tunnelUrl;

  const session = await createSession(
    {
      repoPath: settings.repoPath,
      model,
      contextLimit: settings.contextLimit,
      tunnelUrl,
    },
    sessionStore,
  );
  await runSessionHooks("SessionStart", hooksSettings.hooks);
  return {
    sessionId: session.metadata.id,
    permissionMode,
    branch,
  };
};

const saveToolAction = async (details: {
  toolActions: McpToolAction[];
  getSessionId: () => string;
  sessionStore: { baseDir: string };
  action: McpToolAction;
}): Promise<void> => {
  details.toolActions.push(details.action);
  let actionErrorString: string | undefined;

  if (details.action.data?.error !== undefined) {
    actionErrorString = String(details.action.data.error);
  }

  await Promise.allSettled([
    appendSessionEvent(
      details.getSessionId(),
      {
        type: "action",
        name: details.action.name,
        status: details.action.status,
        content: actionErrorString,
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
  if (persistent) await persistEngineSettings(engineSettings);

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
  void Promise.allSettled([
    appendBridgeLog({
      repoPath: details.config.repoPath,
      type: `chatgpt_${details.message.role}_message`,
      data: { content: details.message.content },
    }),
    appendSessionEvent(
      details.getSessionId(),
      {
        type: "message",
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
  void Promise.allSettled([
    saveSettings(details.config),
    updateSession(
      details.getSessionId(),
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
    const isEventTypeMessage = event.type === "message";
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
    const tunnel = new CloudflareTunnel();
    const tunnelUrl = await tunnel.start(details.config.mcpPort);
    details.config.tunnelUrl = tunnelUrl;
    const connectorUrl = readMcpConnectorUrl(tunnelUrl);

    if (details.persistent) {
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

const connectBrowser = async (details: {
  orchestrator: Orchestrator;
  connectorUrl: string;
  config: BridgeSettings;
  log: (line: string) => void;
  debugPort?: number;
  profileRoot?: string;
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

    if (browser.attachedViaCdp.value) {
      details.log("Browser: attached to Chrome on debug port (reusing your session).");
    } else if (browser.spawnedNew.value) {
      details.log(
        `Browser: started Chrome for ${provider.displayName} on the debug port using the shared bridge profile.`,
      );
    } else {
      details.log("Browser: connected.");
    }

    const canSetupConnector = details.connectorUrl && provider.supportsMcpConnector;
    if (canSetupConnector) {
      const connectorSetup = await details.orchestrator.openConnectorSetup({
        connectorUrl: details.connectorUrl,
        automatic: true,
      });
      if (connectorSetup.completed) {
        details.log("Connector setup: ready");
      } else {
        details.log("Connector setup: needs attention");
      }
    } else if (!provider.supportsMcpConnector) {
      details.log(
        `Provider: ${provider.displayName} web has no MCP connector — @file mentions only.`,
      );
    }
  } catch (error) {
    browser = null;
    const isErrorObject = error instanceof Error;
    const message = isErrorObject ? error.message : String(error);
    details.log(`Browser: failed to connect (${message}).`);
  }
  await Promise.allSettled([details.orchestrator.start()]);
  return browser;
};

const bootEngine = async (settings: StartEngineSettings): Promise<EngineAssembly> => {
  const boot = await loadEngineBootStatus(settings);
  const orchestrator = new Orchestrator(boot.config, undefined, {
    manifestRoot: boot.persistent
      ? readDownloadsDirectory(boot.config.repoPath)
      : readAttachmentManifestsDirectory(),
  });
  const counter = new TokenCounter(boot.config.contextLimit, boot.config.model);
  attachPersistenceListener({
    orchestrator,
    counter,
    config: boot.config,
    getSessionId: boot.getSessionId,
    persistent: boot.persistent,
  });
  let tunnel: { tunnel: CloudflareTunnel | null; connectorUrl: string };

  if (boot.flags.withTunnel) {
    tunnel = await startTunnel({
      config: boot.config,
      sessionId: boot.runtime.sessionId,
      log: boot.log,
      persistent: boot.persistent,
    });
  } else {
    tunnel = { tunnel: null, connectorUrl: "" };
  }

  let browser: BrowserSession | null = null;

  if (boot.flags.withBrowser !== false) {
    browser = await connectBrowser({
      orchestrator,
      connectorUrl: tunnel.connectorUrl,
      config: boot.config,
      log: boot.log,
      debugPort: settings.debugPort,
      profileRoot: settings.profileRoot,
    });
  }

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

  static async start(settings: StartEngineSettings = {}): Promise<BridgeEngine> {
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
      timeoutMs: details.timeoutMs,
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

    if (details.closeBrowser !== true) return;

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

export const startEngine = (settings: StartEngineSettings = {}): Promise<BridgeEngine> => {
  return BridgeEngine.start(settings);
};
