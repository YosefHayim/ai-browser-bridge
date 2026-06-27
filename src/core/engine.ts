import { execFile } from "node:child_process";
import { BrowserManager } from "../browser/manager.ts";
import { CloudflareTunnel } from "../tunnel/cloudflare.ts";
import { startMcpServer, type McpToolAction, type McpServerHandle } from "../mcp/server.ts";
import { Orchestrator } from "./orchestrator.ts";
import { ContextCounter } from "./context-counter.ts";
import { loadConfig, saveConfig } from "./config.ts";
import { loadHooksConfig, runHooks, type LoadedHooksConfig } from "./hooks.ts";
import { normalizePermissionMode, type PermissionMode } from "./permissions.ts";
import { resolveFileMentions } from "./file-resolver.ts";
import { appendBridgeLog } from "./logging.ts";
import { appendSessionEvent, createSession, updateSession } from "./session-store.ts";
import { ensureBridgeDir, sessionsDir } from "./paths.ts";
import type { BridgeConfig, Message } from "../types/types.ts";

const DEFAULT_PORT = 8765;

/**
 * Knobs for {@link startEngine}. The two frontends (Ink TUI and the headless
 * `bridge ask` command) differ only in these flags — the wiring underneath is
 * identical, which is the whole point of extracting the engine.
 */
export interface StartEngineOptions {
  /** Target repository the MCP tools operate inside. Defaults to the saved/cwd repo. */
  repoPath?: string;
  /** MCP server port. Defaults to the saved port or 8765. */
  mcpPort?: number;
  /** Launch/attach Chrome. The TUI always wants this; headless `sessions` does not. */
  withBrowser?: boolean;
  /**
   * Start the local MCP server. Defaults to true. A plain headless `ask` sets this
   * false so it never binds the MCP port (which a running TUI may already hold).
   */
  withTools?: boolean;
  /**
   * Start the Cloudflare tunnel + sync the ChatGPT connector so ChatGPT can call
   * local tools. Defaults to `withTools` (a tunnel without the MCP server is useless).
   */
  withTunnel?: boolean;
  /**
   * Diagnostics sink. Defaults to stderr so that a headless command can keep
   * stdout reserved for machine-readable JSON.
   */
  log?: (line: string) => void;
}

/**
 * A fully wired, running bridge: browser + MCP server + orchestrator + session,
 * with message persistence and context counting already attached.
 *
 * Created by {@link startEngine} and consumed by both frontends. Callers send
 * prompts with {@link Engine.ask} and tear down with {@link Engine.shutdown}.
 */
export interface Engine {
  config: BridgeConfig;
  orchestrator: Orchestrator;
  counter: ContextCounter;
  browser: BrowserManager | null;
  /** Running MCP server, or null when started without tools. */
  mcpServer: McpServerHandle | null;
  tunnel: CloudflareTunnel | null;
  /** Public connector URL (`<tunnel>/mcp`) or "" when no tunnel is running. */
  connectorUrl: string;
  hooksConfig: LoadedHooksConfig;
  /** Tool-call actions recorded this run (used for the status line counter). */
  toolActions: McpToolAction[];
  /** Current git branch of the repo, if any. */
  branch?: string;
  getSessionId(): string;
  setSessionId(id: string): void;
  getPermissionMode(): PermissionMode;
  setPermissionMode(mode: PermissionMode): void;
  /**
   * Resolve `@file` mentions, run the UserPromptSubmit hook, send the prompt
   * through ChatGPT, and return the captured assistant reply (null on failure).
   * Persistence (logs + session events + context counting) happens via the
   * engine's own orchestrator listener, so both frontends get it for free.
   */
  ask(content: string): Promise<Message | null>;
  /**
   * Best-effort: stop the in-flight ChatGPT turn (clicks Stop generating) before
   * teardown, so an interrupted run does not keep generating server-side in the
   * warm tab and waste Plus quota.
   */
  abort(): Promise<void>;
  /** Stop the MCP server and tunnel. Pass `closeBrowser` to also close Chrome. */
  shutdown(opts?: { closeBrowser?: boolean }): Promise<void>;
}

/** Build `<tunnelUrl>/mcp`, the URL ChatGPT's connector points at. */
export function mcpConnectorUrl(tunnelUrl: string): string {
  return `${tunnelUrl.replace(/\/+$/, "")}/mcp`;
}

/**
 * Wire up and start a bridge engine: config, MCP server, optional tunnel and
 * browser, orchestrator, and a fresh session. Diagnostics are written through
 * `options.log` (stderr by default).
 */
export async function startEngine(options: StartEngineOptions = {}): Promise<Engine> {
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const withTools = options.withTools ?? true;
  const withTunnel = options.withTunnel ?? withTools;
  const config = await resolveEngineConfig(options);
  let permissionMode: PermissionMode = normalizePermissionMode(config.permissionMode ?? "auto");
  const hooksConfig = await loadHooksConfig({ repoRoot: config.repoPath });
  for (const error of hooksConfig.errors) log(`Hooks warning: ${error}`);

  const sessionStore = { baseDir: sessionsDir(config.repoPath) };
  const branch = await currentGitBranch(config.repoPath);
  const session = await createSession({
    repoPath: config.repoPath,
    model: config.model ?? null,
    contextLimit: config.contextLimit,
    tunnelUrl: config.tunnelUrl ?? null,
  }, sessionStore);
  let sessionId = session.metadata.id;

  const toolActions: McpToolAction[] = [];
  const recordToolAction = async (action: McpToolAction): Promise<void> => {
    toolActions.push(action);
    await appendSessionEvent(sessionId, {
      type: "action",
      name: action.name,
      status: action.status,
      content: action.data?.error ? String(action.data.error) : undefined,
      data: action.data,
    }, sessionStore).catch(() => {});
  };

  await runHooks("SessionStart", hooksConfig.hooks).catch(() => []);

  let mcpServer: McpServerHandle | null = null;
  if (withTools) {
    mcpServer = await startMcpServer(config.repoPath, config.mcpPort, {
      getPermissionMode: () => permissionMode,
      hooks: hooksConfig.hooks,
      onToolAction: recordToolAction,
    });
    log(`MCP:     ${mcpServer.url}`);
  }

  const orchestrator = new Orchestrator(config);
  const counter = new ContextCounter(config.contextLimit, config.model);

  attachPersistenceListener(orchestrator, counter, config, () => sessionId);

  let tunnel: CloudflareTunnel | null = null;
  let connectorUrl = "";
  if (withTunnel) {
    ({ tunnel, connectorUrl } = await startTunnel(config, sessionId, log));
  }

  const browser = options.withBrowser === false
    ? null
    : await connectBrowser(orchestrator, connectorUrl, config.repoPath, log);

  return {
    config,
    orchestrator,
    counter,
    browser,
    mcpServer,
    tunnel,
    connectorUrl,
    hooksConfig,
    toolActions,
    branch,
    getSessionId: () => sessionId,
    setSessionId: (id) => {
      sessionId = id;
    },
    getPermissionMode: () => permissionMode,
    setPermissionMode: (mode) => {
      permissionMode = mode;
      config.permissionMode = mode;
      saveConfig(config).catch(() => {});
    },
    ask: async (content) => {
      await runHooks("UserPromptSubmit", hooksConfig.hooks).catch(() => []);
      const resolved = await resolveFileMentions(content, config.repoPath);
      return orchestrator.sendPrompt(resolved.prompt);
    },
    abort: async () => {
      await orchestrator.stopResponse().catch(() => {});
    },
    shutdown: async ({ closeBrowser = false } = {}) => {
      await runHooks("SessionEnd", hooksConfig.hooks).catch(() => []);
      tunnel?.stop();
      mcpServer?.close();
      if (closeBrowser) await browser?.close().catch(() => {});
    },
  };
}

/**
 * Load, normalise, and persist the effective config for this run: option
 * overrides win over saved values, the permission mode is normalised, and the
 * result is written back so the next start sees the same settings.
 */
async function resolveEngineConfig(options: StartEngineOptions): Promise<BridgeConfig> {
  const repoPath = options.repoPath ?? process.cwd();
  // Materialize `<repo>/.bridge` and its self-ignoring `.gitignore` before any
  // state (config, sessions, logs) is written into it.
  await ensureBridgeDir(repoPath);

  const saved = await loadConfig(repoPath);
  const config = await loadConfig(repoPath, {
    mcpPort: options.mcpPort ?? saved.mcpPort ?? DEFAULT_PORT,
    tunnelUrl: undefined,
  });
  config.permissionMode = normalizePermissionMode(config.permissionMode ?? "auto");
  await saveConfig(config);
  return config;
}

/**
 * Wire orchestrator events to the durable state: context counting, bridge logs,
 * and session events. This is the single owner of persistence — both frontends
 * layer their own view-only listeners on top. `getSessionId` is read lazily so a
 * later {@link Engine.setSessionId} switch is honoured.
 */
function attachPersistenceListener(
  orchestrator: Orchestrator,
  counter: ContextCounter,
  config: BridgeConfig,
  getSessionId: () => string,
): void {
  const sessionStore = { baseDir: sessionsDir(config.repoPath) };
  orchestrator.on((event) => {
    if (event.type === "message") {
      counter.add(event.message);
      appendBridgeLog({
        repoPath: config.repoPath,
        type: `chatgpt_${event.message.role}_message`,
        data: { content: event.message.content },
      }).catch(() => {});
      appendSessionEvent(getSessionId(), {
        type: "message",
        role: event.message.role,
        content: event.message.content,
        data: { messageId: event.message.id },
      }, sessionStore).catch(() => {});
    }
    if (event.type === "conversation_synced") {
      counter.reset();
      for (const message of event.messages) counter.add(message);
    }
    if (event.type === "reset") {
      counter.reset();
    }
    if (event.type === "model_changed") {
      counter.setModel(event.model);
      config.model = event.model;
      config.contextLimit = event.contextLimit;
      saveConfig(config).catch(() => {});
      updateSession(getSessionId(), { model: event.model, contextLimit: event.contextLimit }, sessionStore).catch(() => {});
    }
  });
}

/**
 * Start the Cloudflare tunnel and sync the connector URL into config + session.
 * Tolerates `cloudflared` being absent: logs a hint and returns nulls so the
 * bridge still runs locally (just without a URL ChatGPT can reach).
 */
async function startTunnel(
  config: BridgeConfig,
  sessionId: string,
  log: (line: string) => void,
): Promise<{ tunnel: CloudflareTunnel | null; connectorUrl: string }> {
  try {
    const tunnel = new CloudflareTunnel();
    const tunnelUrl = await tunnel.start(config.mcpPort);
    config.tunnelUrl = tunnelUrl;
    const connectorUrl = mcpConnectorUrl(tunnelUrl);
    await updateSession(sessionId, { tunnelUrl }, { baseDir: sessionsDir(config.repoPath) }).catch(() => {});
    log(`Tunnel:  ${tunnelUrl}`);
    log(`Connector: ${connectorUrl}`);
    return { tunnel, connectorUrl };
  } catch {
    log("Tunnel: failed to start (cloudflared not installed?). MCP tools require a public URL ChatGPT can reach.");
    return { tunnel: null, connectorUrl: "" };
  }
}

/**
 * Launch/attach Chrome, point the orchestrator at the page, and run connector
 * setup when a connector URL is available. Always starts the orchestrator, and
 * returns null (with a logged reason) if the browser fails to connect.
 */
async function connectBrowser(
  orchestrator: Orchestrator,
  connectorUrl: string,
  repoPath: string,
  log: (line: string) => void,
): Promise<BrowserManager | null> {
  let browser: BrowserManager | null = new BrowserManager(repoPath);
  try {
    const page = await browser.launch();
    orchestrator.setPage(page);
    log("Browser: connected to isolated chatgpt-local-bridge profile.");
    if (connectorUrl) {
      const result = await orchestrator.openConnectorSetup(connectorUrl, { automatic: true });
      log(`Connector setup: ${result.completed ? "ready" : "needs attention"}`);
    }
  } catch (err) {
    browser = null;
    log(`Browser: failed to connect (${err instanceof Error ? err.message : String(err)}).`);
  }
  await orchestrator.start().catch(() => {});
  return browser;
}

/** Resolve the repo's current git branch, or undefined when not a git repo. */
function currentGitBranch(repoPath: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoPath }, (error, stdout) => {
      resolve(error ? undefined : stdout.trim() || undefined);
    });
  });
}
