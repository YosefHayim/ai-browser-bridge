import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { DEFAULT_MCP_PORT, DEFAULT_PERMISSION_MODE } from "@/config";
import { BrowserSession } from "@/features/browser";
import type { BridgeConfig, Message } from "@/features/domain";
import { normalizePermissionMode, type PermissionMode } from "@/features/domain";
import { providerFor, providerIdFrom } from "@/features/providers";
import {
  appendBridgeLog,
  appendSessionEvent,
  attachmentManifestsDir,
  createSession,
  downloadsDir,
  ensureBridgeDir,
  expandFileMentions,
  repositoryRoot,
  sessionsDir,
  updateSession,
} from "@/features/store";
import { type McpServerHandle, type McpToolAction, startMcpServer } from "@/features/tools";
import { CloudflareTunnel } from "@/features/tunnel";
import { loadHooksConfig, runHooks } from "@/features/userConfig";
import type {
  AskEngineInput,
  EngineAssembly,
  EngineRuntimeState,
  ShutdownEngineInput,
  StartEngineOptions,
} from "./bridgeEngineTypes.ts";
import { ContextCounter } from "./contextCounter.ts";
import { loadConfig, saveConfig } from "./loadConfig.ts";
import { Orchestrator } from "./orchestrator.ts";

export const mcpConnectorUrl = (tunnelUrl: string): string => {
  return `${tunnelUrl.replace(/\/+$/, "")}/mcp`;
};

const currentGitBranch = (repoPath: string): Promise<string | undefined> => {
  return new Promise((resolve) => {
    execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoPath }, (error, stdout) => {
      if (error) {
        resolve(undefined);
        return;
      }
      const branch = stdout.trim();
      if (branch.length === 0) {
        resolve(undefined);
        return;
      }
      resolve(branch);
    });
  });
};

const defaultEngineLog = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

const engineLog = (options: StartEngineOptions): ((line: string) => void) => {
  if (options.log !== undefined) return options.log;
  return defaultEngineLog;
};

const logHookWarnings = (errors: string[], log: (line: string) => void): void => {
  for (const error of errors) log(`Hooks warning: ${error}`);
};

const permissionModeFromConfig = (
  permissionMode: BridgeConfig["permissionMode"],
): PermissionMode => {
  if (permissionMode === undefined) {
    return normalizePermissionMode(DEFAULT_PERMISSION_MODE);
  }
  return normalizePermissionMode(permissionMode);
};

const engineConfig = async (options: StartEngineOptions): Promise<BridgeConfig> => {
  const repoPath = repositoryRoot(options.repoPath);
  const savedConfig = await loadConfig(repoPath);

  let provider = options.provider;
  if (provider === undefined) provider = savedConfig.provider;
  if (provider === undefined) provider = "chatgpt";

  let mcpPort = options.mcpPort;
  if (mcpPort === undefined) mcpPort = savedConfig.mcpPort;
  if (mcpPort === undefined) mcpPort = DEFAULT_MCP_PORT;

  const config = await loadConfig(repoPath, {
    provider,
    mcpPort,
    tunnelUrl: undefined,
  });
  config.provider = providerIdFrom(config.provider);
  config.permissionMode = permissionModeFromConfig(config.permissionMode);
  return config;
};

const persistEngineConfig = async (config: BridgeConfig): Promise<void> => {
  await ensureBridgeDir(config.repoPath);
  await saveConfig(config);
};

type EngineFeatureFlags = {
  withTools: boolean;
  withTunnel: boolean;
  withBrowser: boolean | undefined;
};

const engineFeatureFlags = (
  options: StartEngineOptions,
  supportsMcpConnector: boolean,
): EngineFeatureFlags => {
  let defaultWithTools = true;
  if (options.persist === false) defaultWithTools = false;

  let withTools = defaultWithTools;
  if (options.withTools !== undefined) withTools = options.withTools;
  withTools = withTools && supportsMcpConnector;

  let withTunnel = withTools;
  if (options.withTunnel !== undefined) withTunnel = options.withTunnel;
  withTunnel = withTunnel && supportsMcpConnector;

  return { withTools, withTunnel, withBrowser: options.withBrowser };
};

const enginePersistence = (options: StartEngineOptions, flags: EngineFeatureFlags): boolean => {
  if (options.persist !== undefined) {
    if (options.persist) return true;
    return flags.withTools || flags.withTunnel;
  }
  return true;
};

const runSessionHooks = async (
  event: "SessionStart" | "UserPromptSubmit" | "SessionEnd",
  hooks: Awaited<ReturnType<typeof loadHooksConfig>>["hooks"],
): Promise<void> => {
  await Promise.allSettled([runHooks(event, hooks)]);
};

const initEngineRuntime = async (
  config: BridgeConfig,
  hooksConfig: Awaited<ReturnType<typeof loadHooksConfig>>,
  persistent: boolean,
): Promise<EngineRuntimeState & { branch?: string }> => {
  const branch = await currentGitBranch(config.repoPath);
  const permissionMode = permissionModeFromConfig(config.permissionMode);
  if (!persistent) {
    await runSessionHooks("SessionStart", hooksConfig.hooks);
    return {
      sessionId: `stateless-${randomUUID()}`,
      permissionMode,
      branch,
    };
  }
  const sessionStore = { baseDir: sessionsDir(config.repoPath) };
  let model: string | null = null;
  if (config.model !== undefined) model = config.model;
  let tunnelUrl: string | null = null;
  if (config.tunnelUrl !== undefined) tunnelUrl = config.tunnelUrl;
  const session = await createSession(
    {
      repoPath: config.repoPath,
      model,
      contextLimit: config.contextLimit,
      tunnelUrl,
    },
    sessionStore,
  );
  await runSessionHooks("SessionStart", hooksConfig.hooks);
  return {
    sessionId: session.metadata.id,
    permissionMode,
    branch,
  };
};

const recordToolAction = async (input: {
  toolActions: McpToolAction[];
  getSessionId: () => string;
  sessionStore: { baseDir: string };
  action: McpToolAction;
}): Promise<void> => {
  input.toolActions.push(input.action);
  let actionErrorText: string | undefined;
  if (input.action.data?.error !== undefined) {
    actionErrorText = String(input.action.data.error);
  }
  await Promise.allSettled([
    appendSessionEvent(
      input.getSessionId(),
      {
        type: "action",
        name: input.action.name,
        status: input.action.status,
        content: actionErrorText,
        data: input.action.data,
      },
      input.sessionStore,
    ),
  ]);
};

const maybeStartMcp = async (input: {
  config: BridgeConfig;
  flags: EngineFeatureFlags;
  hooksConfig: Awaited<ReturnType<typeof loadHooksConfig>>;
  runtime: EngineRuntimeState;
  toolActions: McpToolAction[];
  log: (line: string) => void;
}): Promise<McpServerHandle | null> => {
  if (!input.flags.withTools) return null;
  const sessionStore = { baseDir: sessionsDir(input.config.repoPath) };
  const getSessionId = () => input.runtime.sessionId;
  const mcpServer = await startMcpServer(input.config.repoPath, input.config.mcpPort, {
    getPermissionMode: () => input.runtime.permissionMode,
    hooks: input.hooksConfig.hooks,
    onToolAction: (action) =>
      recordToolAction({ toolActions: input.toolActions, getSessionId, sessionStore, action }),
  });
  input.log(`MCP:     ${mcpServer.url}`);
  return mcpServer;
};

type EngineBootState = {
  config: BridgeConfig;
  hooksConfig: Awaited<ReturnType<typeof loadHooksConfig>>;
  runtime: EngineRuntimeState & { branch?: string };
  flags: EngineFeatureFlags;
  toolActions: McpToolAction[];
  mcpServer: McpServerHandle | null;
  log: (line: string) => void;
  getSessionId: () => string;
  persistent: boolean;
};

const loadEngineBootState = async (options: StartEngineOptions): Promise<EngineBootState> => {
  const log = engineLog(options);
  const config = await engineConfig(options);
  const flags = engineFeatureFlags(options, providerFor(config.provider).supportsMcpConnector);
  const persistent = enginePersistence(options, flags);
  if (persistent) await persistEngineConfig(config);
  const hooksConfig = await loadHooksConfig({ repoRoot: config.repoPath });
  logHookWarnings(hooksConfig.errors, log);
  const runtime = await initEngineRuntime(config, hooksConfig, persistent);
  const toolActions: McpToolAction[] = [];
  const mcpServer = await maybeStartMcp({ config, flags, hooksConfig, runtime, toolActions, log });
  return {
    config,
    hooksConfig,
    runtime,
    flags,
    toolActions,
    mcpServer,
    log,
    getSessionId: () => runtime.sessionId,
    persistent,
  };
};

const persistMessageEvent = (input: {
  config: BridgeConfig;
  getSessionId: () => string;
  message: Message;
  sessionStore: { baseDir: string };
}): void => {
  void Promise.allSettled([
    appendBridgeLog({
      repoPath: input.config.repoPath,
      type: `chatgpt_${input.message.role}_message`,
      data: { content: input.message.content },
    }),
    appendSessionEvent(
      input.getSessionId(),
      {
        type: "message",
        role: input.message.role,
        content: input.message.content,
        data: { messageId: input.message.id },
      },
      input.sessionStore,
    ),
  ]);
};

const persistModelChange = (input: {
  config: BridgeConfig;
  getSessionId: () => string;
  model: string;
  contextLimit: number;
  sessionStore: { baseDir: string };
}): void => {
  void Promise.allSettled([
    saveConfig(input.config),
    updateSession(
      input.getSessionId(),
      { model: input.model, contextLimit: input.contextLimit },
      input.sessionStore,
    ),
  ]);
};

const attachPersistenceListener = (input: {
  orchestrator: Orchestrator;
  counter: ContextCounter;
  config: BridgeConfig;
  getSessionId: () => string;
  persistent: boolean;
}): void => {
  const sessionStore = { baseDir: sessionsDir(input.config.repoPath) };
  input.orchestrator.on((event) => {
    if (event.type === "message") {
      input.counter.add(event.message);
      if (!input.persistent) return;
      persistMessageEvent({
        config: input.config,
        getSessionId: input.getSessionId,
        message: event.message,
        sessionStore,
      });
      return;
    }
    if (event.type === "conversation_synced") {
      input.counter.reset();
      for (const message of event.messages) input.counter.add(message);
      return;
    }
    if (event.type === "reset") {
      input.counter.reset();
      return;
    }
    if (event.type === "model_changed") {
      input.counter.setModel(event.model);
      input.config.model = event.model;
      input.config.contextLimit = event.contextLimit;
      if (!input.persistent) return;
      persistModelChange({
        config: input.config,
        getSessionId: input.getSessionId,
        model: event.model,
        contextLimit: event.contextLimit,
        sessionStore,
      });
    }
  });
};

const startTunnel = async (input: {
  config: BridgeConfig;
  sessionId: string;
  log: (line: string) => void;
  persistent: boolean;
}): Promise<{ tunnel: CloudflareTunnel | null; connectorUrl: string }> => {
  try {
    const tunnel = new CloudflareTunnel();
    const tunnelUrl = await tunnel.start(input.config.mcpPort);
    input.config.tunnelUrl = tunnelUrl;
    const connectorUrl = mcpConnectorUrl(tunnelUrl);
    if (input.persistent) {
      await Promise.allSettled([
        updateSession(
          input.sessionId,
          { tunnelUrl },
          { baseDir: sessionsDir(input.config.repoPath) },
        ),
      ]);
    }
    input.log(`Tunnel:  ${tunnelUrl}`);
    input.log(`Connector: ${connectorUrl}`);
    return { tunnel, connectorUrl };
  } catch {
    input.log(
      "Tunnel: failed to start (cloudflared not installed?). MCP tools require a public URL the provider connector can reach.",
    );
    return { tunnel: null, connectorUrl: "" };
  }
};

const connectBrowser = async (input: {
  orchestrator: Orchestrator;
  connectorUrl: string;
  config: BridgeConfig;
  log: (line: string) => void;
  debugPort?: number;
  profileRoot?: string;
}): Promise<BrowserSession | null> => {
  const providerId = providerIdFrom(input.config.provider);
  let browser: BrowserSession | null = new BrowserSession(providerId, {
    debugPort: input.debugPort,
    profileRoot: input.profileRoot,
  });
  try {
    const provider = providerFor(providerId);
    const page = await browser.launch();
    input.orchestrator.setPage(page);
    if (browser.attachedViaCdp.value) {
      input.log("Browser: attached to Chrome on debug port (reusing your session).");
    } else if (browser.spawnedNew.value) {
      input.log(
        `Browser: started Chrome for ${provider.displayName} on the debug port using the shared bridge profile.`,
      );
    } else {
      input.log("Browser: connected.");
    }
    if (input.connectorUrl && provider.supportsMcpConnector) {
      const connectorSetup = await input.orchestrator.openConnectorSetup({
        connectorUrl: input.connectorUrl,
        automatic: true,
      });
      if (connectorSetup.completed) {
        input.log("Connector setup: ready");
      } else {
        input.log("Connector setup: needs attention");
      }
    } else if (!provider.supportsMcpConnector) {
      input.log(
        `Provider: ${provider.displayName} web has no MCP connector — @file mentions only.`,
      );
    }
  } catch (error) {
    browser = null;
    const message = error instanceof Error ? error.message : String(error);
    input.log(`Browser: failed to connect (${message}).`);
  }
  await Promise.allSettled([input.orchestrator.start()]);
  return browser;
};

const bootEngine = async (options: StartEngineOptions): Promise<EngineAssembly> => {
  const boot = await loadEngineBootState(options);
  const orchestrator = new Orchestrator(boot.config, undefined, {
    manifestRoot: boot.persistent ? downloadsDir(boot.config.repoPath) : attachmentManifestsDir(),
  });
  const counter = new ContextCounter(boot.config.contextLimit, boot.config.model);
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
      debugPort: options.debugPort,
      profileRoot: options.profileRoot,
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
  readonly config: BridgeConfig;
  readonly counter: ContextCounter;
  readonly browser: BrowserSession | null;
  readonly connectorUrl: string;
  readonly hooksConfig: EngineAssembly["hooksConfig"];
  readonly toolActions: McpToolAction[];
  readonly branch?: string;

  private readonly orchestrator: Orchestrator;
  private readonly mcpServer: McpServerHandle | null;
  private readonly tunnel: CloudflareTunnel | null;
  private runtime: EngineRuntimeState;

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

  static async start(options: StartEngineOptions = {}): Promise<BridgeEngine> {
    return new BridgeEngine(await bootEngine(options));
  }

  getOrchestrator(): Orchestrator {
    return this.orchestrator;
  }

  async ask(input: AskEngineInput): Promise<Message | null> {
    await runSessionHooks("UserPromptSubmit", this.hooksConfig.hooks);
    const expanded = await expandFileMentions(input.content, this.config.repoPath);
    return this.orchestrator.sendPrompt({
      content: expanded.prompt,
      timeoutMs: input.timeoutMs,
      expectImages: input.expectImages,
    });
  }

  async shutdown(input: ShutdownEngineInput = {}): Promise<void> {
    await Promise.allSettled([
      this.orchestrator.stopResponse(),
      runHooks("SessionEnd", this.hooksConfig.hooks),
    ]);
    this.tunnel?.stop();
    this.mcpServer?.close();
    if (input.closeBrowser !== true) return;
    if (this.browser === null) return;
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
    this.runtime.permissionMode = normalizePermissionMode(mode);
    this.assembly.runtime.permissionMode = this.runtime.permissionMode;
    this.config.permissionMode = this.runtime.permissionMode;
    if (!this.assembly.persistent) return;
    void Promise.allSettled([saveConfig(this.config)]);
  }
}

export const startEngine = (options: StartEngineOptions = {}): Promise<BridgeEngine> => {
  return BridgeEngine.start(options);
};
