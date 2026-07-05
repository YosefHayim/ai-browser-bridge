import { execFile } from "node:child_process";
import { DEFAULT_MCP_PORT, DEFAULT_PERMISSION_MODE } from "@/config";
import { type ModelProfile, UNKNOWN_MODEL_PROFILE, findModelProfile } from "@/features/domain";
import { type PermissionMode, normalizePermissionMode } from "@/features/domain";
import type { BridgeConfig, Message } from "@/features/domain";
import { BrowserManager } from "@/features/providers";
import { getBrowserProvider, normalizeProvider } from "@/features/providers";
import { resolveFileMentions } from "@/features/store";
import { appendBridgeLog } from "@/features/store";
import { ensureBridgeDir, sessionsDir } from "@/features/store";
import { appendSessionEvent, createSession, updateSession } from "@/features/store";
import { type McpServerHandle, type McpToolAction, startMcpServer } from "@/features/tools";
import { CloudflareTunnelClass } from "@/features/tunnel";
import { runHooks } from "@/features/user-config";
import { loadHooksConfig } from "@/features/user-config";
import type {
  AskEngineInput,
  BuildEngineContext,
  EngineRuntimeState,
  ShutdownEngineInput,
  StartEngineOptions,
} from "../bridgeEngineTypes.ts";
import { loadConfig, saveConfig } from "../loadConfig.ts";
import { Orchestrator } from "./orchestrator.ts";

/** Build `<tunnelUrl>/mcp`, the URL ChatGPT's connector points at. */
export function mcpConnectorUrl(tunnelUrl: string): string {
  return `${tunnelUrl.replace(/\/+$/, "")}/mcp`;
}

/** Rough character-to-token ratio for estimation. */
const DEFAULT_CHARS_PER_TOKEN = 4;
const ANTHROPIC_CHARS_PER_TOKEN = 3.5;
const MESSAGE_OVERHEAD_TOKENS = 4;

/** Estimate token count for a single string. */
export function estimateTokens(text: string, charsPerToken = DEFAULT_CHARS_PER_TOKEN): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / charsPerToken);
}

/** Running context counter that tracks usage against a limit. */
class ContextCounter {
  private total = 0;
  private profile: ModelProfile;

  constructor(
    private limit: number,
    modelName?: string,
  ) {
    this.profile = modelName ? findModelProfile(modelName) : UNKNOWN_MODEL_PROFILE;
    if (modelName) this.limit = this.profile.contextWindow;
  }

  get contextLimit(): number {
    return this.limit;
  }

  get modelLabel(): string {
    return this.profile.label;
  }

  get modelProfile(): ModelProfile {
    return this.profile;
  }

  add(message: Message): void {
    this.total += MESSAGE_OVERHEAD_TOKENS + this.estimateForProvider(message.content);
    for (const tc of message.toolCalls ?? []) {
      this.total +=
        MESSAGE_OVERHEAD_TOKENS + this.estimateForProvider(JSON.stringify(tc.arguments));
    }
  }

  get count(): number {
    return this.total;
  }

  get fraction(): number {
    return this.total / this.limit;
  }

  get summary(): string {
    const pct = (this.fraction * 100).toFixed(1);
    return `~${this.total.toLocaleString()} / ${this.limit.toLocaleString()} (${pct}%)`;
  }

  get isNearLimit(): boolean {
    return this.fraction > 0.8;
  }

  reset(): void {
    this.total = 0;
  }

  setLimit(limit: number): void {
    this.limit = limit;
  }

  setModel(modelName: string): void {
    this.profile = findModelProfile(modelName);
    this.limit = this.profile.contextWindow;
  }

  private estimateForProvider(text: string): number {
    const charsPerToken =
      this.profile.provider === "anthropic" ? ANTHROPIC_CHARS_PER_TOKEN : DEFAULT_CHARS_PER_TOKEN;
    return estimateTokens(text, charsPerToken);
  }
}

/** Default MCP server port when none is configured. */

/** Resolve the repo's current git branch, or undefined when not a git repo. */
function currentGitBranch(repoPath: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoPath }, (error, stdout) => {
      resolve(error ? undefined : stdout.trim() || undefined);
    });
  });
}

function defaultEngineLog(line: string): void {
  process.stderr.write(`${line}\n`);
}

function resolveEngineLog(options: StartEngineOptions): (line: string) => void {
  return options.log ?? defaultEngineLog;
}

function logHookWarnings(errors: string[], log: (line: string) => void): void {
  for (const error of errors) log(`Hooks warning: ${error}`);
}

/** Load, normalise, and persist the effective config for this run. */
async function resolveEngineConfig(options: StartEngineOptions): Promise<BridgeConfig> {
  const repoPath = options.repoPath ?? process.cwd();
  await ensureBridgeDir(repoPath);
  const saved = await loadConfig(repoPath);
  const config = await loadConfig(repoPath, {
    provider: options.provider ?? saved.provider ?? "chatgpt",
    mcpPort: options.mcpPort ?? saved.mcpPort ?? DEFAULT_MCP_PORT,
    tunnelUrl: undefined,
  });
  config.provider = normalizeProvider(config.provider);
  config.permissionMode = normalizePermissionMode(config.permissionMode ?? DEFAULT_PERMISSION_MODE);
  await saveConfig(config);
  return config;
}

interface EngineFeatureFlags {
  withTools: boolean;
  withTunnel: boolean;
  withBrowser: boolean | undefined;
}

function resolveEngineFlags(
  options: StartEngineOptions,
  supportsMcpConnector: boolean,
): EngineFeatureFlags {
  const withTools = (options.withTools ?? true) && supportsMcpConnector;
  const withTunnel = (options.withTunnel ?? withTools) && supportsMcpConnector;
  return { withTools, withTunnel, withBrowser: options.withBrowser };
}

async function initEngineRuntime(
  config: BridgeConfig,
  hooksConfig: Awaited<ReturnType<typeof loadHooksConfig>>,
): Promise<EngineRuntimeState & { branch?: string }> {
  const sessionStore = { baseDir: sessionsDir(config.repoPath) };
  const branch = await currentGitBranch(config.repoPath);
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
}

async function recordToolAction(input: {
  toolActions: McpToolAction[];
  getSessionId: () => string;
  sessionStore: { baseDir: string };
  action: McpToolAction;
}): Promise<void> {
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
}

async function maybeStartMcp(input: {
  config: BridgeConfig;
  flags: EngineFeatureFlags;
  hooksConfig: Awaited<ReturnType<typeof loadHooksConfig>>;
  runtime: EngineRuntimeState;
  toolActions: McpToolAction[];
  log: (line: string) => void;
}): Promise<McpServerHandle | null> {
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
}

interface EngineBootState {
  config: BridgeConfig;
  hooksConfig: Awaited<ReturnType<typeof loadHooksConfig>>;
  runtime: EngineRuntimeState & { branch?: string };
  flags: EngineFeatureFlags;
  toolActions: McpToolAction[];
  mcpServer: McpServerHandle | null;
  log: (line: string) => void;
  getSessionId: () => string;
}

async function loadEngineBootState(options: StartEngineOptions): Promise<EngineBootState> {
  const log = resolveEngineLog(options);
  const config = await resolveEngineConfig(options);
  const hooksConfig = await loadHooksConfig({ repoRoot: config.repoPath });
  const flags = resolveEngineFlags(
    options,
    getBrowserProvider(config.provider).supportsMcpConnector,
  );
  logHookWarnings(hooksConfig.errors, log);
  const runtime = await initEngineRuntime(config, hooksConfig);
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
  };
}

function attachPersistenceListener(input: {
  orchestrator: Orchestrator;
  counter: ContextCounter;
  config: BridgeConfig;
  getSessionId: () => string;
}): void {
  const sessionStore = { baseDir: sessionsDir(input.config.repoPath) };
  input.orchestrator.on((event) => {
    if (event.type === "message") {
      input.counter.add(event.message);
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
      saveConfig(input.config).catch(() => {});
      updateSession(
        input.getSessionId(),
        { model: event.model, contextLimit: event.contextLimit },
        sessionStore,
      ).catch(() => {});
    }
  });
}

async function startTunnel(input: {
  config: BridgeConfig;
  sessionId: string;
  log: (line: string) => void;
}): Promise<{ tunnel: CloudflareTunnelClass | null; connectorUrl: string }> {
  try {
    const tunnel = new CloudflareTunnelClass();
    const tunnelUrl = await tunnel.start(input.config.mcpPort);
    input.config.tunnelUrl = tunnelUrl;
    const connectorUrl = mcpConnectorUrl(tunnelUrl);
    await updateSession(
      input.sessionId,
      { tunnelUrl },
      { baseDir: sessionsDir(input.config.repoPath) },
    ).catch(() => {});
    input.log(`Tunnel:  ${tunnelUrl}`);
    input.log(`Connector: ${connectorUrl}`);
    return { tunnel, connectorUrl };
  } catch {
    input.log(
      "Tunnel: failed to start (cloudflared not installed?). MCP tools require a public URL ChatGPT can reach.",
    );
    return { tunnel: null, connectorUrl: "" };
  }
}

async function connectBrowser(input: {
  orchestrator: Orchestrator;
  connectorUrl: string;
  config: BridgeConfig;
  log: (line: string) => void;
}): Promise<BrowserManager | null> {
  const providerId = normalizeProvider(input.config.provider);
  let browser: BrowserManager | null = new BrowserManager(input.config.repoPath, providerId);
  try {
    const provider = getBrowserProvider(providerId);
    const page = await browser.launch();
    input.orchestrator.setPage(page);
    if (browser.attachedViaCdp.value) {
      input.log("Browser: attached to Chrome on debug port (reusing your session).");
    } else if (browser.spawnedNew.value) {
      input.log(`Browser: started isolated ${provider.displayName} profile.`);
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
}

async function bootEngine(options: StartEngineOptions): Promise<BuildEngineContext> {
  const boot = await loadEngineBootState(options);
  const orchestrator = new Orchestrator(boot.config);
  const counter = new ContextCounter(boot.config.contextLimit, boot.config.model);
  attachPersistenceListener({
    orchestrator,
    counter,
    config: boot.config,
    getSessionId: boot.getSessionId,
  });
  const tunnel = boot.flags.withTunnel
    ? await startTunnel({ config: boot.config, sessionId: boot.runtime.sessionId, log: boot.log })
    : { tunnel: null, connectorUrl: "" };
  const browser =
    boot.flags.withBrowser === false
      ? null
      : await connectBrowser({
          orchestrator,
          connectorUrl: tunnel.connectorUrl,
          config: boot.config,
          log: boot.log,
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
  };
}

/** Fully wired bridge runtime: browser, MCP, orchestrator, and session. */
export class BridgeEngine {
  readonly config: BridgeConfig;
  readonly counter: ContextCounter;
  readonly browser: BrowserManager | null;
  readonly connectorUrl: string;
  readonly hooksConfig: BuildEngineContext["hooksConfig"];
  readonly toolActions: McpToolAction[];
  readonly branch?: string;

  private readonly orchestrator: Orchestrator;
  private readonly mcpServer: McpServerHandle | null;
  private readonly tunnel: CloudflareTunnelClass | null;
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

  /** Wire up and start a bridge engine. */
  static async start(options: StartEngineOptions = {}): Promise<BridgeEngine> {
    return new BridgeEngine(await bootEngine(options));
  }

  /** Browser automation coordinator. */
  getOrchestrator(): Orchestrator {
    return this.orchestrator;
  }

  /** Resolve file mentions, run hooks, and send the prompt. */
  async ask(input: AskEngineInput): Promise<Message | null> {
    await runHooks("UserPromptSubmit", this.hooksConfig.hooks).catch(() => []);
    const resolved = await resolveFileMentions(input.content, this.config.repoPath);
    return this.orchestrator.sendPrompt({
      content: resolved.prompt,
      timeoutMs: input.timeoutMs,
      expectImages: input.expectImages,
    });
  }

  /** Run SessionEnd hooks and stop tunnel, MCP server, and optionally Chrome. */
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
    saveConfig(this.config).catch(() => {});
  }
}

export type {
  AskEngineInput,
  ShutdownEngineInput,
  StartEngineOptions,
} from "../bridgeEngineTypes.ts";
export { ContextCounter };
