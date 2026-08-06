import { execFile, spawn } from "node:child_process";
import { mkdirSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { Browser, BrowserContext, Page, Response } from "playwright";
import { chromium } from "playwright";
import type { BridgeProviderId } from "@/config";
import type { Conversation } from "@/features/domain";
import { type BrowserProvider, providerFor } from "@/features/providers";
import { bridgeChromeProfileRoot, chromeAppName } from "./browserProfile.ts";

/** Chrome remote-debugging port the shared bridge profile attaches to / spawns on. */
export const BRIDGE_DEBUG_PORT = 9222;

// Matches a Chrome command line arg like --user-data-dir=/Users/me/Profile.
const USER_DATA_DIR_ARG = /--user-data-dir=(?<userDataDir>[^\s]+)/;

const cdpUrlForPort = (port: number): string => `http://127.0.0.1:${port}`;
const execFileAsync = promisify(execFile);

/** Parse `--user-data-dir=` from the Chrome process bound to a debug port. */
export const getUserDataDirOnDebugPort = async (
  port: number = BRIDGE_DEBUG_PORT,
): Promise<string | null> => {
  try {
    const { stdout } = await execFileAsync("ps", ["ax", "-o", "command="]);
    const remoteDebuggingPortArg = `--remote-debugging-port=${port}`;
    for (const line of stdout.split("\n")) {
      if (!line.includes(remoteDebuggingPortArg)) continue;
      const userDataDir = USER_DATA_DIR_ARG.exec(line)?.groups?.userDataDir;
      if (userDataDir === undefined) continue;
      return userDataDir;
    }
    return null;
  } catch {
    return null;
  }
};

/** Whether two profile directories refer to the same path. */
export const profilesMatch = (expected: string, actual: string): boolean => {
  const normalize = (value: string): string => {
    try {
      return realpathSync(resolve(value));
    } catch {
      return resolve(value);
    }
  };
  return normalize(expected) === normalize(actual);
};

const waitForDebugPortClosed = async (port: number, maxWaitMs = 10_000): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (!(await isDebugPortListening({ port }))) return;
    await sleep(250);
  }
};

/** Stop Chrome processes listening on the debug port (wrong profile recovery). */
export const terminateChromeOnDebugPort = async (
  port: number = BRIDGE_DEBUG_PORT,
): Promise<void> => {
  try {
    await execFileAsync("pkill", ["-f", `--remote-debugging-port=${port}`]);
  } catch {
    /* no matching process */
  }
  await waitForDebugPortClosed(port);
};

/** Raised when Chrome is open but not reachable on the debug port. */
export class BrowserAttachError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserAttachError";
  }
}

/** Whether localhost responds on the Chrome remote debugging port. */
export const isDebugPortListening = async (
  input: { readonly port?: number } = {},
): Promise<boolean> => {
  let port = BRIDGE_DEBUG_PORT;
  if (input.port !== undefined) {
    port = input.port;
  }
  try {
    const versionResponse = await fetch(`http://127.0.0.1:${port}/json/version`);
    return versionResponse.ok;
  } catch {
    return false;
  }
};

/** Whether the configured Chrome app process is running on macOS. */
export const isChromeProcessRunning = (
  input: { readonly appName?: string } = {},
): Promise<boolean> => {
  let appName = chromeAppName();
  if (input.appName !== undefined) {
    appName = input.appName;
  }
  return new Promise((done) => {
    execFile("pgrep", ["-f", `${appName}.app/Contents/MacOS`], (error, stdout) => {
      done(error === null && stdout.trim().length > 0);
    });
  });
};

const sleep = (ms: number): Promise<void> => {
  return new Promise((settle) => setTimeout(settle, ms));
};

const waitForDebugPort = async (port: number, maxWaitMs = 30_000): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await isDebugPortListening({ port })) return;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for Chrome debug port ${port}`);
};

type BrowserSessionOptions = {
  /** Debug port to attach/spawn on. Defaults to the shared bridge port (9222). */
  readonly debugPort?: number;
  /** Chrome user-data-dir. Defaults to the shared bridge profile root. */
  readonly profileRoot?: string;
};

/**
 * Chrome argv for a bridge debug profile.
 *
 * @param defaultUrl - URL Chrome opens on launch (kept as the final positional arg).
 * @param profileRoot - Chrome user-data-dir; defaults to the shared bridge profile.
 * @param port - Remote-debugging port; defaults to the shared bridge port (9222).
 */
export const chromeLaunchArgs = (
  defaultUrl: string,
  profileRoot: string = bridgeChromeProfileRoot(),
  port: number = BRIDGE_DEBUG_PORT,
): string[] => {
  return [
    `--remote-debugging-port=${port}`,
    // Chrome 136+ rejects CDP clients without an explicit allowlist.
    "--remote-allow-origins=*",
    `--user-data-dir=${profileRoot}`,
    "--no-first-run",
    "--no-default-browser-check",
    // Extension service workers in a Google-signed-in profile attach as CDP targets
    // that report no browserContextId, which crashes Playwright's connectOverCDP with
    // an uncaught assertion in its attach handler (no try/catch can catch it). Browser
    // automation never needs the user's extensions, and sign-in lives in cookies — not
    // extensions — so disabling them keeps every provider attachable, including Gemini
    // and Flow, which require Google sign-in (and thus pull in extension workers).
    "--disable-extensions",
    "--disable-component-extensions-with-background-pages",
    defaultUrl,
  ];
};

const spawnChrome = (
  defaultUrl: string,
  profileRoot: string = bridgeChromeProfileRoot(),
  port: number = BRIDGE_DEBUG_PORT,
): void => {
  mkdirSync(profileRoot, { recursive: true });
  const child = spawn(
    "open",
    ["-na", chromeAppName(), "--args", ...chromeLaunchArgs(defaultUrl, profileRoot, port)],
    {
      detached: true,
      stdio: "ignore",
    },
  );
  child.unref();
};

const attachOnlyError = (port: number): BrowserAttachError => {
  return new BrowserAttachError(
    `No Chrome listening on debug port ${port}. Run \`bridge chrome start\` before using browser automation.`,
  );
};

/**
 * Force Playwright to drop the CDP websocket on `browser.close()` instead of
 * sending Chrome's Browser.close (which quits the shared bridge profile).
 */
const markCdpDisconnectOnly = (browser: Browser): void => {
  // Playwright internal flag — true for `connect()`, false for `connectOverCDP`.
  (browser as Browser & { _shouldCloseConnectionOnClose?: boolean })._shouldCloseConnectionOnClose =
    true;
};

const spawnReadyError = (port: number): BrowserAttachError => {
  return new BrowserAttachError(`Chrome started but debug port ${port} did not become ready.`);
};

type CdpConnectState = {
  browser: Browser | null;
  context: BrowserContext | null;
  page: Page | null;
};

const findProviderPage = (
  browser: Browser,
  provider: BrowserProvider,
): { context: BrowserContext; page: Page } | null => {
  for (const browserContext of browser.contexts()) {
    for (const page of browserContext.pages()) {
      if (page.url().includes(provider.origin)) {
        return { context: browserContext, page };
      }
    }
  }
  return null;
};

const navigateIfNeeded = async (page: Page, provider: BrowserProvider): Promise<void> => {
  wireSafeDialogHandlers(page);
  if (!page.url().includes(provider.origin)) {
    await page.goto(provider.defaultUrl, { waitUntil: "domcontentloaded" });
  }
  await page.waitForSelector(provider.composerSelector, { timeout: 30_000 }).catch(() => {});
};

/** Dismiss JS alerts/confirms without crashing when CDP races Playwright's dialog manager. */
const wireSafeDialogHandlers = (page: Page): void => {
  if ((page as Page & { __bridgeDialogWired?: boolean }).__bridgeDialogWired) return;
  (page as Page & { __bridgeDialogWired?: boolean }).__bridgeDialogWired = true;
  page.on("dialog", (dialog) => {
    void dialog.dismiss().catch(() => undefined);
  });
};

const wireSafeDialogHandlersForContext = (context: BrowserContext): void => {
  for (const page of context.pages()) wireSafeDialogHandlers(page);
  context.on("page", (page) => wireSafeDialogHandlers(page));
};

const interceptResponses = (
  context: BrowserContext,
  providerId: string,
  conversations: Conversation[],
): void => {
  context.on("response", (response: Response) => {
    if (providerId !== "chatgpt") return;
    void parseChatGptConversations(response, conversations).catch(() => {});
  });
};

const parseChatGptConversations = async (
  response: Response,
  conversations: Conversation[],
): Promise<void> => {
  const url = response.url();
  if (!url.includes("/backend-api/conversations?")) return;
  const conversationListJson = await response.json().catch(() => null);
  const items = conversationListJson?.items;
  if (!Array.isArray(items)) return;
  conversations.splice(
    0,
    conversations.length,
    ...items.map((item: Record<string, unknown>) => {
      let title = "Untitled";
      if (item.title !== undefined && item.title !== null) {
        title = String(item.title);
      }
      return {
        id: String(item.id),
        title,
        url: `https://chatgpt.com/c/${item.id}`,
      };
    }),
  );
};

const tryConnectOverCdp = async (input: {
  readonly state: CdpConnectState;
  readonly provider: BrowserProvider;
  readonly cdpUrl: string;
  readonly attempts?: number;
  readonly intervalMs?: number;
  readonly isPortListening: () => Promise<boolean>;
  readonly close: () => Promise<void>;
}): Promise<boolean> => {
  let attempts = 8;
  if (input.attempts !== undefined) {
    attempts = input.attempts;
  }
  let intervalMs = 400;
  if (input.intervalMs !== undefined) {
    intervalMs = input.intervalMs;
  }
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (!(await input.isPortListening())) {
      if (attempt < attempts - 1) await sleep(intervalMs);
      continue;
    }
    if (await connectOnceOverCdp(input)) return true;
    if (attempt < attempts - 1) await sleep(intervalMs);
  }
  return false;
};

const connectOnceOverCdp = async (input: {
  readonly state: CdpConnectState;
  readonly provider: BrowserProvider;
  readonly cdpUrl: string;
  readonly close: () => Promise<void>;
}): Promise<boolean> => {
  try {
    input.state.browser = await chromium.connectOverCDP(input.cdpUrl);
    // Playwright's default CDP close() sends Browser.close and quits Chrome.
    // The bridge owns a shared user profile — disconnect the socket only.
    markCdpDisconnectOnly(input.state.browser);
    const found = findProviderPage(input.state.browser, input.provider);
    if (found) {
      input.state.context = found.context;
      input.state.page = found.page;
      console.error(`  Connected to running Chrome, found ${input.provider.origin} tab.`);
    } else {
      const [firstContext] = input.state.browser.contexts();
      if (!firstContext) {
        await input.close();
        return false;
      }
      input.state.context = firstContext;
      input.state.page = await firstContext.newPage();
      console.error(
        `  Connected to running Chrome, no ${input.provider.origin} tab — opening one.`,
      );
    }
    return Boolean(input.state.page);
  } catch {
    await input.close();
    return false;
  }
};

/** Manages the Playwright browser connected to Chrome's debug port. */
export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private conversations: Conversation[] = [];
  private readonly providerId: BridgeProviderId;
  private readonly provider: BrowserProvider;
  private readonly debugPort: number;
  private readonly profileRoot: string;
  readonly attachedViaCdp = { value: false };
  readonly spawnedNew = { value: false };

  constructor(providerId: BridgeProviderId = "chatgpt", options: BrowserSessionOptions = {}) {
    this.providerId = providerId;
    this.provider = providerFor(providerId);
    if (options.debugPort === undefined) {
      this.debugPort = BRIDGE_DEBUG_PORT;
    } else {
      this.debugPort = options.debugPort;
    }
    if (options.profileRoot === undefined) {
      this.profileRoot = bridgeChromeProfileRoot();
    } else {
      this.profileRoot = options.profileRoot;
    }
  }

  /** CDP websocket URL for this session's debug port. */
  private cdpUrl(): string {
    return cdpUrlForPort(this.debugPort);
  }

  /** Launch Chrome or attach to an existing debug session. */
  async launch(): Promise<Page> {
    await this.resetSession();
    if (await this.connectExisting()) return this.markAttached();
    return await this.continueLaunch();
  }

  /** Attach to an already-running Chrome debug session without spawning a new window. */
  async attach(options?: {
    readonly attempts?: number;
    readonly intervalMs?: number;
  }): Promise<Page> {
    await this.resetSession();
    if (await this.connectExisting(options)) return this.markAttached();
    throw attachOnlyError(this.debugPort);
  }

  /**
   * Open a fresh tab in the attached browser context and navigate it to `url`.
   *
   * Fan-out primitive: each parallel Conversation gets its own page in the one
   * shared-profile Chrome so concurrent tasks never collide on a single tab.
   */
  async openTab(url: string): Promise<Page> {
    if (!this.context) throw new Error("Browser not launched. Call launch() or attach() first.");
    const page = await this.context.newPage();
    wireSafeDialogHandlers(page);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    return page;
  }

  /** Return the active Playwright page, or throw if the browser is not launched. */
  getPage(): Page {
    if (!this.page) throw new Error("Browser not launched. Call launch() first.");
    return this.page;
  }

  /** Close the browser session and reset internal state. */
  async close(): Promise<void> {
    const browser = this.browser;
    this.page = null;
    this.context = null;
    this.browser = null;
    if (!browser) return;
    // Shared bridge Chrome must survive CLI process exit / re-attach.
    markCdpDisconnectOnly(browser);
    try {
      await browser.close();
    } catch {
      // Ignore already-closed / transport-gone errors on disconnect.
    }
    this.attachedViaCdp.value = false;
  }

  /** Clear any active session before a new launch or attach. */
  private async resetSession(): Promise<void> {
    if (this.context || this.browser) await this.close();
  }

  /** Mark the session as attached via CDP and return the active page. */
  private markAttached(): Page {
    this.attachedViaCdp.value = true;
    return this.getPage();
  }

  /** Spawn Chrome or attach when the debug port is already open. */
  private async continueLaunch(): Promise<Page> {
    if (await isDebugPortListening({ port: this.debugPort })) {
      const connected = await this.connectExisting({ attempts: 20, intervalMs: 500 });
      if (connected) return this.getPage();
      throw new BrowserAttachError(
        `Chrome debug port ${this.debugPort} is open but the bridge could not attach. Run \`bridge status\` to inspect the Chrome owner.`,
      );
    }
    return await this.runSpawnAndConnect();
  }

  /** Spawn Chrome and wait for a CDP connection. */
  private async runSpawnAndConnect(): Promise<Page> {
    console.error("  Launching Chrome with bridge debug port using the shared bridge profile.");
    spawnChrome(this.provider.defaultUrl, this.profileRoot, this.debugPort);
    this.spawnedNew.value = true;
    console.error("  Waiting for Chrome debug port...");
    await waitForDebugPort(this.debugPort);
    const connected = await this.connectExisting({ attempts: 20, intervalMs: 500 });
    if (!connected || !this.page) throw spawnReadyError(this.debugPort);
    return this.getPage();
  }

  /** Mutable CDP fields for connect helpers. */
  private cdpState(): CdpConnectState {
    return { browser: this.browser, context: this.context, page: this.page };
  }

  /** Apply CDP connection results to instance fields. */
  private applyCdpState(state: CdpConnectState): void {
    this.browser = state.browser;
    this.context = state.context;
    this.page = state.page;
  }

  /** Retry CDP attach until a provider page is available. */
  private async connectExisting(options?: {
    readonly attempts?: number;
    readonly intervalMs?: number;
  }): Promise<boolean> {
    const state = this.cdpState();
    const connected = await tryConnectOverCdp({
      state,
      provider: this.provider,
      cdpUrl: this.cdpUrl(),
      attempts: options?.attempts,
      intervalMs: options?.intervalMs,
      isPortListening: () => isDebugPortListening({ port: this.debugPort }),
      close: () => this.close(),
    });
    if (!connected) return false;
    this.finalizeCdpConnection(state);
    return true;
  }

  /** Wire response listeners and navigate after a successful CDP attach. */
  private finalizeCdpConnection(state: CdpConnectState): void {
    this.applyCdpState(state);
    const { context, page } = state;
    if (!context || !page) return;
    wireSafeDialogHandlersForContext(context);
    interceptResponses(context, this.providerId, this.conversations);
    void navigateIfNeeded(page, this.provider);
  }
}
