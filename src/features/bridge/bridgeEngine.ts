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
  BuildEngineContext,
  EngineRuntimeState,
  ShutdownEngineInput,
  StartEngineOptions,
} from "./bridgeEngineTypes.ts";
import { ContextCounter } from "./contextCounter.ts";
import { loadConfig, saveConfig } from "./loadConfig.ts";
import { Orchestrator } from "./orchestrator.ts";

/**
 * Build `<tunnelUrl>/mcp`, the URL ChatGPT's connector points at.
 *
 * @param tunnelUrl - Tunnel url value.
 * @returns The `mcpConnectorUrl` result.
 * @example
 * ```ts
 * const result = mcpConnectorUrl(tunnelUrl);
 * ```
 */
export const mcpConnectorUrl = (tunnelUrl: string): string => {
  return `${tunnelUrl.replace(/\/+$/, "")}/mcp`;
};

/** Resolve the repo's current git branch, or undefined when not a git repo. */
const currentGitBranch = (repoPath: string): Promise<string | undefined> => {
  return new Promise((resolve) => {
    execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoPath }, (error, stdout) => {
      resolve(error ? undefined : stdout.trim() || undefined);
    });
  });
};

const defaultEngineLog = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

const engineLog = (options: StartEngineOptions): ((line: string) => void) => {
  return options.log ?? defaultEngineLog;
};

const logHookWarnings = (errors: string[], log: (line: string) => void): void => {
  for (const error of errors) log(`Hooks warning: ${error}`);
};

/** Load and normalise the effective config for this run. */
const engineConfig = async (options: StartEngineOptions): Promise<BridgeConfig> => {
  const repoPath = repositoryRoot(options.repoPath);
  const saved = await loadConfig(repoPath);
  const config = await loadConfig(repoPath, {
    provider: options.provider ?? saved.provider ?? "chatgpt",
    mcpPort: options.mcpPort ?? saved.mcpPort ?? DEFAULT_MCP_PORT,
    tunnelUrl: undefined,
  });
  config.provider = providerIdFrom(config.provider);
  config.permissionMode = normalizePermissionMode(config.permissionMode ?? DEFAULT_PERMISSION_MODE);
  return config;
};

/** Persist the effective run config and assert the repo-local bridge guard. */
const persistEngineConfig = async (config: BridgeConfig): Promise<void> => {
  await ensureBridgeDir(config.repoPath);
  await saveConfig(config);
};

interface EngineFeatureFlags {
  withTools: boolean;
  withTunnel: boolean;
  withBrowser: boolean | undefined;
}

const engineFeatureFlags = (
  options: StartEngineOptions,
  supportsMcpConnector: boolean,
): EngineFeatureFlags => {
  const defaultWithTools = options.persist !== false;
  const withTools = (options.withTools ?? defaultWithTools) && supportsMcpConnector;
  const withTunnel = (options.withTunnel ?? withTools) && supportsMcpConnector;
  return { withTools, withTunnel, withBrowser: options.withBrowser };
};

/** Decide whether this run should write repo-local sessions, logs, and config. */
const enginePersistence = (options: StartEngineOptions, flags: EngineFeatureFlags): boolean => {
  return (options.persist ?? true) || flags.withTools || flags.withTunnel;
};

const initEngineRuntime = async (
  config: BridgeConfig,
  hooksConfig: Awaited<ReturnType<typeof loadHooksConfig>>,
  persistent: boolean,
): Promise<EngineRuntimeState & { branch?: string }> => {
  const branch = await currentGitBranch(config.repoPath);
  if (!persistent) {
    await runHooks("SessionStart", hooksConfig.hooks).catch(() => []);
    return {
      sessionId: `stateless-${randomUUID()}`,
      permissionMode: normalizePermissionMode(config.permissionMode ?? DEFAULT_PERMISSION_MODE),
      branch,
    };
  }
  const sessionStore = { baseDir: sessionsDir(config.repoPath) };
  const session = await createSession(
    {
      repoPath: config.repoPath,
      model: config.model ?? null,
      contextLimit: config.contextLimit,
      tunnelUrl: config.tunnelUrl ?? null,
    },
    sessionStore,
  );
  await runHooks("SessionStart", hooksConfig.hooks).catch(() => []);
  return {
    sessionId: session.metadata.id,
    permissionMode: normalizePermissionMode(config.permissionMode ?? DEFAULT_PERMISSION_MODE),
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
  await appendSessionEvent(
    input.getSessionId(),
    {
      type: "action",
      name: input.action.name,
      status: input.action.status,
      content: input.action.data?.error ? String(input.action.data.error) : undefined,
      data: input.action.data,
    },
    input.sessionStore,
  ).catch(() => {});
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

interface EngineBootState {
  config: BridgeConfig;
  hooksConfig: Awaited<ReturnType<typeof loadHooksConfig>>;
  runtime: EngineRuntimeState & { branch?: string };
  flags: EngineFeatureFlags;
  toolActions: McpToolAction[];
  mcpServer: McpServerHandle | null;
  log: (line: string) => void;
  getSessionId: () => string;
  persistent: boolean;
}

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
      appendBridgeLog({
        repoPath: input.config.repoPath,
        type: `chatgpt_${event.message.role}_message`,
        data: { content: event.message.content },
      }).catch(() => {});
      appendSessionEvent(
        input.getSessionId(),
        {
          type: "message",
          role: event.message.role,
          content: event.message.content,
          data: { messageId: event.message.id },
        },
        sessionStore,
      ).catch(() => {});
    }
    if (event.type === "conversation_synced") {
      input.counter.reset();
      for (const message of event.messages) input.counter.add(message);
    }
    if (event.type === "reset") input.counter.reset();
    if (event.type === "model_changed") {
      input.counter.setModel(event.model);
      input.config.model = event.model;
      input.config.contextLimit = event.contextLimit;
      if (!input.persistent) return;
      saveConfig(input.config).catch(() => {});
      updateSession(
        input.getSessionId(),
        { model: event.model, contextLimit: event.contextLimit },
        sessionStore,
      ).catch(() => {});
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
      await updateSession(
        input.sessionId,
        { tunnelUrl },
        { baseDir: sessionsDir(input.config.repoPath) },
      ).catch(() => {});
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
      const result = await input.orchestrator.openConnectorSetup({
        connectorUrl: input.connectorUrl,
        automatic: true,
      });
      input.log(`Connector setup: ${result.completed ? "ready" : "needs attention"}`);
    } else if (!provider.supportsMcpConnector) {
      input.log(
        `Provider: ${provider.displayName} web has no MCP connector — @file mentions only.`,
      );
    }
  } catch (err) {
    browser = null;
    input.log(`Browser: failed to connect (${err instanceof Error ? err.message : String(err)}).`);
  }
  await input.orchestrator.start().catch(() => {});
  return browser;
};

const bootEngine = async (options: StartEngineOptions): Promise<BuildEngineContext> => {
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
  const tunnel = boot.flags.withTunnel
    ? await startTunnel({
        config: boot.config,
        sessionId: boot.runtime.sessionId,
        log: boot.log,
        persistent: boot.persistent,
      })
    : { tunnel: null, connectorUrl: "" };
  const browser =
    boot.flags.withBrowser === false
      ? null
      : await connectBrowser({
          orchestrator,
          connectorUrl: tunnel.connectorUrl,
          config: boot.config,
          log: boot.log,
          debugPort: options.debugPort,
          profileRoot: options.profileRoot,
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

/** Fully wired bridge runtime: browser, MCP, orchestrator, and session. */
export class BridgeEngine {
  readonly config: BridgeConfig;
  readonly counter: ContextCounter;
  readonly browser: BrowserSession | null;
  readonly connectorUrl: string;
  readonly hooksConfig: BuildEngineContext["hooksConfig"];
  readonly toolActions: McpToolAction[];
  readonly branch?: string;

  private readonly orchestrator: Orchestrator;
  private readonly mcpServer: McpServerHandle | null;
  private readonly tunnel: CloudflareTunnel | null;
  private runtime: EngineRuntimeState;

  private constructor(private readonly ctx: BuildEngineContext) {
    this.config = ctx.config;
    this.orchestrator = ctx.orchestrator;
    this.counter = ctx.counter;
    this.browser = ctx.browser;
    this.mcpServer = ctx.mcpServer;
    this.tunnel = ctx.tunnel;
    this.connectorUrl = ctx.connectorUrl;
    this.hooksConfig = ctx.hooksConfig;
    this.toolActions = ctx.toolActions;
    this.branch = ctx.branch;
    this.runtime = { ...ctx.runtime };
  }

  /**
   * Wire up and start a bridge engine.
   *
   * @param options - Options that configure the method.
   * @returns The `start` result.
   * @example
   * ```ts
   * const result = await bridgeEngine.start(options);
   * ```
   */
  static async start(options: StartEngineOptions = {}): Promise<BridgeEngine> {
    return new BridgeEngine(await bootEngine(options));
  }

  /**
   * Browser automation coordinator.
   *
   * @returns The `getOrchestrator` result.
   * @example
   * ```ts
   * const result = bridgeEngine.getOrchestrator();
   * ```
   */
  getOrchestrator(): Orchestrator {
    return this.orchestrator;
  }

  /**
   * Resolve file mentions, run hooks, and send the prompt.
   *
   * @param input - Input values for the method.
   * @returns The `ask` result.
   * @example
   * ```ts
   * const result = await bridgeEngine.ask(input);
   * ```
   */
  async ask(input: AskEngineInput): Promise<Message | null> {
    await runHooks("UserPromptSubmit", this.hooksConfig.hooks).catch(() => []);
    const resolved = await expandFileMentions(input.content, this.config.repoPath);
    return this.orchestrator.sendPrompt({
      content: resolved.prompt,
      timeoutMs: input.timeoutMs,
      expectImages: input.expectImages,
    });
  }

  /**
   * Run SessionEnd hooks and stop tunnel, MCP server, and optionally Chrome.
   *
   * @param input - Input values for the method.
   * @returns Completes when `shutdown` finishes.
   * @example
   * ```ts
   * await bridgeEngine.shutdown(input);
   * ```
   */
  async shutdown(input: ShutdownEngineInput = {}): Promise<void> {
    await this.orchestrator.stopResponse().catch(() => {});
    await runHooks("SessionEnd", this.hooksConfig.hooks).catch(() => []);
    this.tunnel?.stop();
    this.mcpServer?.close();
    if (input.closeBrowser) await this.browser?.close().catch(() => {});
  }

  get sessionId(): string {
    return this.runtime.sessionId;
  }

  set sessionId(id: string) {
    this.runtime.sessionId = id;
    this.ctx.runtime.sessionId = id;
  }

  get permissionMode(): PermissionMode {
    return this.runtime.permissionMode;
  }

  set permissionMode(mode: PermissionMode) {
    this.runtime.permissionMode = normalizePermissionMode(mode);
    this.ctx.runtime.permissionMode = this.runtime.permissionMode;
    this.config.permissionMode = this.runtime.permissionMode;
    if (!this.ctx.persistent) return;
    saveConfig(this.config).catch(() => {});
  }
}

export const startEngine = (options: StartEngineOptions = {}): Promise<BridgeEngine> => {
  return BridgeEngine.start(options);
};
