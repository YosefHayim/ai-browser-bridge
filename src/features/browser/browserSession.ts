import { execFile, spawn } from "node:child_process";
import { mkdirSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { Browser, BrowserContext, Page, Response } from "playwright";
import { chromium } from "playwright";
import type { BridgeProviderId } from "@/config";
import type { Conversation } from "@/features/domain";
import { type BrowserProvider, providerFor, providerIdForUrl } from "@/features/providers";
import {
  BROWSER_CHOICE_ENV,
  bridgeChromeProfileRoot,
  chromeAppName,
  configuredBrowserChoice,
  type MyChromeDebugTarget,
  myChromeDebugTarget,
} from "./browserProfile.ts";
import type { BrowserChoice } from "./browserSchemas.ts";

export const BRIDGE_DEBUG_PORT = 9222;
// Your own Chrome asks you to click Allow on every connection, so wait for that click.
const MY_CHROME_ALLOW_TIMEOUT_MS = 60_000;

// Matches a Chrome command line arg like --user-data-dir=/Users/me/Profile.
const USER_DATA_DIR_ARG = /--user-data-dir=(?<userDataDir>[^\s]+)/;

const cdpUrlForPort = (port: number): string => `http://127.0.0.1:${port}`;
const execFileAsync = promisify(execFile);

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

const waitForDebugPortClosed = async (port: number, maxWaitMs = 10_000): Promise<boolean> => {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (!(await isDebugPortListening({ port }))) return true;
    await sleep(250);
  }
  return false;
};

const PS_LINE = /^\s*(?<pid>\d+)\s+(?<command>.*)$/;

const bridgeChromePids = async (port: number, profileRoot: string): Promise<number[]> => {
  const { stdout } = await execFileAsync("ps", ["ax", "-o", "pid=,command="]);
  const portSwitch = new RegExp(`--remote-debugging-port=${port}( |$)`);
  const pids: number[] = [];
  for (const line of stdout.split("\n")) {
    const match = PS_LINE.exec(line);
    if (match?.groups === undefined || !portSwitch.test(line)) continue;
    const userDataDir = USER_DATA_DIR_ARG.exec(line)?.groups?.userDataDir;
    if (userDataDir === undefined || !profilesMatch(profileRoot, userDataDir)) continue;
    pids.push(Number(match.groups.pid));
  }
  return pids;
};

// Your own Chrome can hold the same port (chrome://inspect remote debugging), so a Chrome
// counts as the bridge's only when it also runs from the bridge profile directory.
export const terminateChromeOnDebugPort = async (
  port: number = BRIDGE_DEBUG_PORT,
  profileRoot: string = bridgeChromeProfileRoot(),
): Promise<boolean> => {
  let pids: number[] = [];
  try {
    pids = await bridgeChromePids(port, profileRoot);
  } catch {
    return false;
  }
  if (pids.length === 0) return false;
  for (const pid of pids) process.kill(pid);
  const closed = await waitForDebugPortClosed(port);
  if (!closed) {
    throw new BrowserAttachError(
      `Asked the bridge Chrome to quit, but debug port ${port} is still open.`,
    );
  }
  return true;
};

export class BrowserAttachError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserAttachError";
  }
}

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

export const isChromeProcessRunning = (
  input: { readonly appName?: string } = {},
): Promise<boolean> => {
  let appName = chromeAppName();
  if (input.appName !== undefined) {
    appName = input.appName;
  }
  return new Promise((resolveRunning) => {
    execFile("pgrep", ["-f", `${appName}.app/Contents/MacOS`], (error, stdout) => {
      resolveRunning(error === null && stdout.trim().length > 0);
    });
  });
};

const sleep = (ms: number): Promise<void> => {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
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
  readonly debugPort?: number;
  readonly profileRoot?: string;
  readonly browserChoice?: BrowserChoice;
};

// Chrome argv for a bridge debug profile. Final positional arg is the launch URL.
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
    // Claude Design runs each turn's agent loop inside its tab; a throttled background
    // tab stalls the turn.
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
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

// Force Playwright to drop the CDP websocket on browser.close() instead of
// sending Chrome's Browser.close (which quits the shared bridge profile).
const markCdpDisconnectOnly = (browser: Browser): void => {
  // Playwright internal flag — true for connect(), false for connectOverCDP.
  (browser as Browser & { _shouldCloseConnectionOnClose?: boolean })._shouldCloseConnectionOnClose =
    true;
};

const debugPortVersionStatus = async (port: number): Promise<number | undefined> => {
  try {
    const versionResponse = await fetch(`http://127.0.0.1:${port}/json/version`);
    return versionResponse.status;
  } catch {
    return undefined;
  }
};

// DevToolsActivePort outlives the toggle, so the port must also answer without the bridge
// Chrome's /json/version: your own Chrome in toggle mode answers 404 there.
export const assertPortNotHeldByOwnChrome = (
  port: number,
  ownChromeTarget: MyChromeDebugTarget | undefined,
  versionStatus: number | undefined,
): void => {
  if (ownChromeTarget?.port !== port) return;
  if (versionStatus === undefined || versionStatus === 200) return;
  throw new BrowserAttachError(
    `Your own Chrome is using port ${port} for remote debugging, so the bridge Chrome cannot use it. Set ${BROWSER_CHOICE_ENV}=my-chrome to use your own Chrome, or turn off remote debugging at chrome://inspect/#remote-debugging.`,
  );
};

const spawnReadyError = (port: number): BrowserAttachError => {
  return new BrowserAttachError(`Chrome started but debug port ${port} did not become ready.`);
};

const myChromeOffError = (): BrowserAttachError => {
  return new BrowserAttachError(
    "Remote debugging is off in your Chrome. Turn it on at chrome://inspect/#remote-debugging, then run the command again and click Allow.",
  );
};

const myChromeConnectError = (cause: unknown): BrowserAttachError => {
  const reason = String(cause);
  return new BrowserAttachError(
    `Could not connect to your Chrome. Click Allow when Chrome asks, and keep remote debugging on at chrome://inspect/#remote-debugging. (${reason})`,
  );
};

const connectOverMyChromeEndpoint = async (endpoint: string): Promise<Browser> => {
  try {
    return await chromium.connectOverCDP(endpoint, { timeout: MY_CHROME_ALLOW_TIMEOUT_MS });
  } catch (error) {
    throw myChromeConnectError(error);
  }
};

// Always a new tab: the bridge never types into a tab you opened yourself.
const connectMyChrome = async (endpoint: string): Promise<MyChromeState> => {
  const browser = await connectOverMyChromeEndpoint(endpoint);
  markCdpDisconnectOnly(browser);
  const [defaultContext] = browser.contexts();
  if (!defaultContext) {
    await Promise.allSettled([browser.close()]);
    throw new BrowserAttachError("Your Chrome has no profile window the bridge can open a tab in.");
  }
  const page = await defaultContext.newPage();
  console.error("  Connected to your Chrome, opened a bridge tab.");
  return { browser, context: defaultContext, page };
};

type MyChromeState = { browser: Browser; context: BrowserContext; page: Page };

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
      if (providerIdForUrl(page.url()) === provider.id) {
        return { context: browserContext, page };
      }
    }
  }
  return null;
};

const navigateIfNeeded = async (page: Page, provider: BrowserProvider): Promise<void> => {
  wireSafeDialogHandlers(page);
  if (providerIdForUrl(page.url()) !== provider.id) {
    await page.goto(provider.defaultUrl, { waitUntil: "domcontentloaded" });
  }
  try {
    await page.waitForSelector(provider.composerSelector, { timeout: 30_000 });
  } catch {
    // Composer may still be loading; attach succeeds without it.
  }
};

// Dismiss JS alerts/confirms without crashing when CDP races Playwright's dialog manager.
const wireSafeDialogHandlers = (page: Page): void => {
  if ((page as Page & { __bridgeDialogWired?: boolean }).__bridgeDialogWired) return;
  (page as Page & { __bridgeDialogWired?: boolean }).__bridgeDialogWired = true;
  page.on("dialog", (dialog) => {
    void Promise.allSettled([dialog.dismiss()]);
  });
};

const wireSafeDialogHandlersForContext = (context: BrowserContext): void => {
  for (const page of context.pages()) wireSafeDialogHandlers(page);
  context.on("page", (page) => wireSafeDialogHandlers(page));
};

const interceptChatGptConversationList = (
  context: BrowserContext,
  providerId: string,
  conversations: Conversation[],
): void => {
  context.on("response", (httpResponse: Response) => {
    if (providerId !== "chatgpt") return;
    void captureChatGptConversationList(httpResponse, conversations);
  });
};

const captureChatGptConversationList = async (
  httpResponse: Response,
  conversations: Conversation[],
): Promise<void> => {
  try {
    const url = httpResponse.url();
    if (!url.includes("/backend-api/conversations?")) return;
    let conversationListJson: unknown;
    try {
      conversationListJson = await httpResponse.json();
    } catch {
      return;
    }
    if (
      conversationListJson === null ||
      typeof conversationListJson !== "object" ||
      !("items" in conversationListJson)
    ) {
      return;
    }
    const conversationItems = conversationListJson.items;
    if (!Array.isArray(conversationItems)) return;
    conversations.splice(
      0,
      conversations.length,
      ...conversationItems.map((entry: Record<string, unknown>) => {
        let title = "Untitled";
        if (entry.title !== undefined && entry.title !== null) {
          title = String(entry.title);
        }
        return {
          id: String(entry.id),
          title,
          url: `https://chatgpt.com/c/${entry.id}`,
        };
      }),
    );
  } catch {
    // Response body may already be consumed or non-JSON; list capture is best-effort.
  }
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

export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private conversations: Conversation[] = [];
  private readonly providerId: BridgeProviderId;
  private readonly provider: BrowserProvider;
  private readonly debugPort: number;
  private readonly profileRoot: string;
  private readonly browserChoice: BrowserChoice;
  private ownsPage = false;
  readonly attachedViaCdp = { value: false };
  readonly spawnedNew = { value: false };

  constructor(providerId: BridgeProviderId = "chatgpt", options: BrowserSessionOptions = {}) {
    this.providerId = providerId;
    this.provider = providerFor(providerId);
    if (options.browserChoice === undefined) {
      this.browserChoice = configuredBrowserChoice();
    } else {
      this.browserChoice = options.browserChoice;
    }
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

  private cdpUrl(): string {
    return cdpUrlForPort(this.debugPort);
  }

  async launch(): Promise<Page> {
    await this.resetSession();
    if (this.browserChoice === "my-chrome") return await this.attachMyChrome();
    if (await this.connectExisting()) return this.markAttached();
    return await this.continueLaunch();
  }

  async attach(options?: {
    readonly attempts?: number;
    readonly intervalMs?: number;
  }): Promise<Page> {
    await this.resetSession();
    if (this.browserChoice === "my-chrome") return await this.attachMyChrome();
    if (await this.connectExisting(options)) return this.markAttached();
    throw attachOnlyError(this.debugPort);
  }

  // Fan-out primitive: each parallel Conversation gets its own page in the one
  // shared-profile Chrome so concurrent tasks never collide on a single tab.
  async openTab(url: string): Promise<Page> {
    if (!this.context) throw new Error("Browser not launched. Call launch() or attach() first.");
    const page = await this.context.newPage();
    wireSafeDialogHandlers(page);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    return page;
  }

  getPage(): Page {
    if (!this.page) throw new Error("Browser not launched. Call launch() first.");
    return this.page;
  }

  // Your own Chrome keeps running; only the tab the bridge opened in it goes away.
  async closeOwnTab(): Promise<void> {
    const page = this.page;
    if (!this.ownsPage || !page) return;
    this.ownsPage = false;
    await Promise.allSettled([page.close()]);
  }

  async close(): Promise<void> {
    await this.closeOwnTab();
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

  private async resetSession(): Promise<void> {
    if (this.context || this.browser) await this.close();
  }

  private markAttached(): Page {
    this.attachedViaCdp.value = true;
    return this.getPage();
  }

  private async attachMyChrome(): Promise<Page> {
    const debugTarget = myChromeDebugTarget();
    if (debugTarget === undefined) throw myChromeOffError();
    const state = await connectMyChrome(debugTarget.endpoint);
    this.ownsPage = true;
    this.finalizeCdpConnection(state);
    await navigateIfNeeded(state.page, this.provider);
    return this.markAttached();
  }

  private async continueLaunch(): Promise<Page> {
    const versionStatus = await debugPortVersionStatus(this.debugPort);
    assertPortNotHeldByOwnChrome(this.debugPort, myChromeDebugTarget(), versionStatus);
    if (await isDebugPortListening({ port: this.debugPort })) {
      const connected = await this.connectExisting({ attempts: 20, intervalMs: 500 });
      if (connected) return this.getPage();
      throw new BrowserAttachError(
        `Chrome debug port ${this.debugPort} is open but the bridge could not attach. Run \`bridge status\` to inspect the Chrome owner.`,
      );
    }
    return await this.runSpawnAndConnect();
  }

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

  private cdpState(): CdpConnectState {
    return { browser: this.browser, context: this.context, page: this.page };
  }

  private applyCdpState(state: CdpConnectState): void {
    this.browser = state.browser;
    this.context = state.context;
    this.page = state.page;
  }

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
    if (state.page) void navigateIfNeeded(state.page, this.provider);
    return true;
  }

  private finalizeCdpConnection(state: CdpConnectState): void {
    this.applyCdpState(state);
    const { context, page } = state;
    if (!context || !page) return;
    wireSafeDialogHandlersForContext(context);
    interceptChatGptConversationList(context, this.providerId, this.conversations);
  }
}
