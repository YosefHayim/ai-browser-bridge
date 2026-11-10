import { execFile, spawn } from "node:child_process";
import { mkdirSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { Browser, BrowserContext, Page, Response } from "playwright";
import { chromium } from "playwright";
import type { BridgeProviderId } from "@/config";
import type { Conversation } from "@/domain/message-types.ts";
import type { BrowserProvider } from "@/providers/browser-provider.ts";
import { readProvider, readProviderIdForUrl } from "@/providers/providers.ts";
import {
  BROWSER_CHOICE_ENVIRONMENT,
  type MyChromeDebugTarget,
  myChromeDebugTarget,
  readBridgeChromeProfileRoot,
  readChromeAppName,
  readConfiguredBrowserChoice,
} from "./browser-profile.ts";
import type { BrowserChoice } from "./browser-schemas.ts";

export const BRIDGE_DEBUG_PORT = 9222;
// Your own Chrome asks you to click Allow on every connection, so wait for that click.
const MY_CHROME_ALLOW_TIMEOUT_MS = 60_000;

// Matches a Chrome command line arg like --user-data-dir=/Users/me/Profile.
const USER_PROFILE_DIRECTORY_FLAG = /--user-data-dir=(?<userDataDir>[^\s]+)/;

// localhost resolves to IPv4 or IPv6, since Chrome can listen only on [::1].
const createDebugPortUrl = (port: number): string => `http://localhost:${port}`;
const execFileAsync = promisify(execFile);

export const getUserProfileDirectoryOnDebugPort = async (
  port: number = BRIDGE_DEBUG_PORT,
): Promise<string | null> => {
  try {
    const { stdout } = await execFileAsync("ps", ["ax", "-o", "command="]);
    const remoteDebuggingPortArg = `--remote-debugging-port=${port}`;
    for (const line of stdout.split("\n")) {
      const isDebugPortArgMissingFromLine = !line.includes(remoteDebuggingPortArg);
      if (isDebugPortArgMissingFromLine) continue;

      const userProfileDirectory = USER_PROFILE_DIRECTORY_FLAG.exec(line)?.groups?.userDataDir;
      const isUserDirectoryMissing = userProfileDirectory == null;
      if (isUserDirectoryMissing) continue;

      return userProfileDirectory;
    }
    return null;
  } catch {
    return null;
  }
};

export const isSameProfile = (expected: string, actual: string): boolean => {
  const cleanString = (field: string): string => {
    try {
      const absolutePath = resolve(field);
      return realpathSync(absolutePath);
    } catch {
      return resolve(field);
    }
  };
  return cleanString(expected) === cleanString(actual);
};

const waitForDebugPortClosed = async (port: number, maxWaitMs = 10_000): Promise<boolean> => {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const isPortListening = await isDebugPortListening({ port });
    const isDebugPortClosed = !isPortListening;
    if (isDebugPortClosed) return true;

    await sleep(250);
  }
  return false;
};

const PS_LINE = /^\s*(?<pid>\d+)\s+(?<command>.*)$/;

const listBridgeChromePids = async (port: number, profileRoot: string): Promise<number[]> => {
  const { stdout } = await execFileAsync("ps", ["ax", "-o", "pid=,command="]);
  const portSwitch = new RegExp(`--remote-debugging-port=${port}( |$)`);
  const pids: number[] = [];
  for (const line of stdout.split("\n")) {
    const hit = PS_LINE.exec(line);
    if (hit?.groups == null || !portSwitch.test(line)) continue;

    const userProfileDirectory = USER_PROFILE_DIRECTORY_FLAG.exec(line)?.groups?.userDataDir;
    const isProfileNotMatched =
      userProfileDirectory == null || !isSameProfile(profileRoot, userProfileDirectory);
    if (isProfileNotMatched) continue;

    const processId = Number(hit.groups.pid);
    pids.push(processId);
  }
  return pids;
};

// Your own Chrome can hold the same port (chrome://inspect remote debugging), so a Chrome
// counts as the bridge's only when it also runs from the bridge profile directory.
export const terminateChromeOnDebugPort = async (
  port: number = BRIDGE_DEBUG_PORT,
  profileRoot: string = readBridgeChromeProfileRoot(),
): Promise<boolean> => {
  let pids: number[] = [];
  try {
    pids = await listBridgeChromePids(port, profileRoot);
  } catch {
    return false;
  }

  const isPidsEmpty = pids.length === 0;
  if (isPidsEmpty) return false;

  for (const pid of pids) process.kill(pid);

  const closed = await waitForDebugPortClosed(port);
  const isNotClosed = !closed;
  if (isNotClosed) {
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
  details: { readonly port?: number } = {},
): Promise<boolean> => {
  let port = BRIDGE_DEBUG_PORT;
  const hasPort = details.port != null;
  if (hasPort) {
    port = details.port;
  }

  try {
    const debugPortUrl = createDebugPortUrl(port);
    const versionReply = await fetch(`${debugPortUrl}/json/version`);
    return versionReply.ok;
  } catch {
    return false;
  }
};

export const isChromeProcessRunning = (
  details: { readonly appName?: string } = {},
): Promise<boolean> => {
  let appName = readChromeAppName();
  const hasAppName = details.appName != null;
  if (hasAppName) {
    appName = details.appName;
  }

  return new Promise((fulfillRunning) => {
    execFile("pgrep", ["-f", `${appName}.app/Contents/MacOS`], (error, stdout) => {
      fulfillRunning(error == null && stdout.trim().length > 0);
    });
  });
};

const sleep = (ms: number): Promise<void> => {
  return new Promise((fulfillSleep) => setTimeout(fulfillSleep, ms));
};

const waitForDebugPort = async (port: number, maxWaitMs = 30_000): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const isDebugPortOpen = await isDebugPortListening({ port });
    if (isDebugPortOpen) return;

    await sleep(500);
  }
  throw new Error(`Timed out waiting for Chrome debug port ${port}`);
};

type BrowserSessionSettings = {
  readonly debugPort?: number;
  readonly profileRoot?: string;
  readonly browserChoice?: BrowserChoice;
};

// Chrome argv for a bridge debug profile. Final positional arg is the launch URL.
export const listChromeLaunchArgumentList = (
  defaultUrl: string,
  profileRoot: string = readBridgeChromeProfileRoot(),
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
  profileRoot: string = readBridgeChromeProfileRoot(),
  port: number = BRIDGE_DEBUG_PORT,
): void => {
  mkdirSync(profileRoot, { recursive: true });
  const child = spawn(
    "open",
    [
      "-na",
      readChromeAppName(),
      "--args",
      ...listChromeLaunchArgumentList(defaultUrl, profileRoot, port),
    ],
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

const BROWSER_CLOSE_TIMEOUT_MS = 5_000;

// browser.close() on a connectOverCDP browser can wait for a closed event that never comes.
export const closeBrowserWithin = async (
  browser: Pick<Browser, "close">,
  timeoutMs: number = BROWSER_CLOSE_TIMEOUT_MS,
): Promise<void> => {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<void>((fulfillTimeout) => {
    timer = setTimeout(fulfillTimeout, timeoutMs);
  });
  try {
    await Promise.race([browser.close(), timedOut]);
  } catch {
    // Ignore already-closed / transport-gone errors on disconnect.
  } finally {
    clearTimeout(timer);
  }
};

const readDebugPortVersionStatus = async (port: number): Promise<number | null> => {
  try {
    const versionReply = await fetch(`http://127.0.0.1:${port}/json/version`);
    return versionReply.status;
  } catch {
    return null;
  }
};

// DevToolsActivePort outlives the toggle, so the port must also answer without the bridge
// Chrome's /json/version: your own Chrome in toggle mode answers 404 there.
export const assertPortNotHeldByOwnChrome = (
  port: number,
  ownChromeTarget: MyChromeDebugTarget | undefined,
  versionStatus: number | null,
): void => {
  const isOwnChromeOnOtherPort = ownChromeTarget?.port !== port;
  if (isOwnChromeOnOtherPort) return;

  const isVersionCheckSettled = versionStatus == null || versionStatus === 200;
  if (isVersionCheckSettled) return;

  throw new BrowserAttachError(
    `Your own Chrome is using port ${port} for remote debugging, so the bridge Chrome cannot use it. Set ${BROWSER_CHOICE_ENVIRONMENT}=my-chrome to use your own Chrome, or turn off remote debugging at chrome://inspect/#remote-debugging.`,
  );
};

const spawnReadyError = (port: number): BrowserAttachError => {
  return new BrowserAttachError(`Chrome started but debug port ${port} did not become ready.`);
};

const writeMyChromeOffError = (): BrowserAttachError => {
  return new BrowserAttachError(
    "Remote debugging is off in your Chrome. Turn it on at chrome://inspect/#remote-debugging, then run the command again and click Allow.",
  );
};

const writeMyChromeConnectError = (cause: unknown): BrowserAttachError => {
  const reason = String(cause);
  return new BrowserAttachError(
    `Could not connect to your Chrome. Click Allow when Chrome asks, and keep remote debugging on at chrome://inspect/#remote-debugging. (${reason})`,
  );
};

const connectOverMyChromeEndpoint = async (endpoint: string): Promise<Browser> => {
  try {
    return await chromium.connectOverCDP(endpoint, { timeout: MY_CHROME_ALLOW_TIMEOUT_MS });
  } catch (error) {
    throw writeMyChromeConnectError(error);
  }
};

// Always a new tab: the bridge never types into a tab you opened yourself.
const connectMyChrome = async (endpoint: string): Promise<MyChromeStatus> => {
  const browser = await connectOverMyChromeEndpoint(endpoint);
  markCdpDisconnectOnly(browser);

  const [defaultProfile] = browser.contexts();

  const isDefaultProfileMissing = defaultProfile == null;
  if (isDefaultProfileMissing) {
    await Promise.allSettled([browser.close()]);
    throw new BrowserAttachError("Your Chrome has no profile window the bridge can open a tab in.");
  }

  const page = await defaultProfile.newPage();
  console.error("  Connected to your Chrome, opened a bridge tab.");
  return { browser, context: defaultProfile, page };
};

type MyChromeStatus = { browser: Browser; context: BrowserContext; page: Page };

type CdpConnectStatus = {
  browser: Browser | null;
  context: BrowserContext | null;
  page: Page | null;
};

const findProviderPage = (
  browser: Browser,
  provider: BrowserProvider,
): { context: BrowserContext; page: Page } | null => {
  for (const browserProfile of browser.contexts()) {
    for (const page of browserProfile.pages()) {
      const pageUrl = page.url();
      const isPageOnProvider = readProviderIdForUrl(pageUrl) === provider.id;
      if (isPageOnProvider) {
        return { context: browserProfile, page };
      }
    }
  }
  return null;
};

const navigateIfNeeded = async (page: Page, provider: BrowserProvider): Promise<void> => {
  wireSafeDialogHandlers(page);

  const pageUrl = page.url();
  const isPageOnOtherProvider = readProviderIdForUrl(pageUrl) !== provider.id;
  if (isPageOnOtherProvider) {
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

const wireSafeDialogHandlersInProfile = (profile: BrowserContext): void => {
  for (const page of profile.pages()) wireSafeDialogHandlers(page);
  profile.on("page", (page) => wireSafeDialogHandlers(page));
};

const interceptChatGptConversationList = (
  profile: BrowserContext,
  providerId: string,
  conversations: Conversation[],
): void => {
  profile.on("response", (httpReply: Response) => {
    const isProviderIdNotChatgpt = providerId !== "chatgpt";
    if (isProviderIdNotChatgpt) return;

    void captureChatGptConversationList(httpReply, conversations);
  });
};

const captureChatGptConversationList = async (
  httpReply: Response,
  conversations: Conversation[],
): Promise<void> => {
  try {
    const url = httpReply.url();
    const isNotBackendApiConversationsInUrl = !url.includes("/backend-api/conversations?");
    if (isNotBackendApiConversationsInUrl) return;

    let conversationListDocument: unknown;
    try {
      conversationListDocument = await httpReply.json();
    } catch {
      return;
    }

    if (
      conversationListDocument === null ||
      typeof conversationListDocument !== "object" ||
      !("items" in conversationListDocument)
    ) {
      return;
    }

    const conversationElements = conversationListDocument.items;
    const isNotConversationArray = !Array.isArray(conversationElements);
    if (isNotConversationArray) return;

    conversations.splice(
      0,
      conversations.length,
      ...conversationElements.map((line: Record<string, unknown>) => {
        let title = "Untitled";
        const hasTitle = line.title != null;
        if (hasTitle) {
          title = String(line.title);
        }

        return {
          id: String(line.id),
          title,
          url: `https://chatgpt.com/c/${line.id}`,
        };
      }),
    );
  } catch {
    // Response body may already be consumed or non-JSON; list capture is best-effort.
  }
};

const tryConnectOverCdp = async (details: {
  readonly state: CdpConnectStatus;
  readonly provider: BrowserProvider;
  readonly cdpUrl: string;
  readonly attempts?: number;
  readonly intervalMs?: number;
  readonly isPortListening: () => Promise<boolean>;
  readonly close: () => Promise<void>;
}): Promise<boolean> => {
  let attempts = 8;
  const hasAttempts = details.attempts != null;
  if (hasAttempts) {
    attempts = details.attempts;
  }

  let intervalMs = 400;
  const hasIntervalMs = details.intervalMs != null;
  if (hasIntervalMs) {
    intervalMs = details.intervalMs;
  }

  for (let attempt = 0; attempt < attempts; attempt++) {
    const isPortListening = await details.isPortListening();
    const isPortClosed = !isPortListening;
    if (isPortClosed) {
      const hasAttemptsLeft = attempt < attempts - 1;
      if (hasAttemptsLeft) await sleep(intervalMs);

      continue;
    }

    const hasConnectedOverCdp = await connectOnceOverCdp(details);
    if (hasConnectedOverCdp) return true;

    const hasRetryAttemptsLeft = attempt < attempts - 1;
    if (hasRetryAttemptsLeft) await sleep(intervalMs);
  }
  return false;
};

const connectOnceOverCdp = async (details: {
  readonly state: CdpConnectStatus;
  readonly provider: BrowserProvider;
  readonly cdpUrl: string;
  readonly close: () => Promise<void>;
}): Promise<boolean> => {
  try {
    details.state.browser = await chromium.connectOverCDP(details.cdpUrl);
    // Playwright's default CDP close() sends Browser.close and quits Chrome.
    // The bridge owns a shared user profile — disconnect the socket only.
    markCdpDisconnectOnly(details.state.browser);

    const found = findProviderPage(details.state.browser, details.provider);
    if (found) {
      details.state.context = found.context;
      details.state.page = found.page;
      console.error(`  Connected to running Chrome, found ${details.provider.origin} tab.`);
    } else {
      const [firstProfile] = details.state.browser.contexts();

      const isFirstProfileMissing = firstProfile == null;
      if (isFirstProfileMissing) {
        await details.close();
        return false;
      }

      details.state.context = firstProfile;
      details.state.page = await firstProfile.newPage();
      console.error(
        `  Connected to running Chrome, no ${details.provider.origin} tab — opening one.`,
      );
    }

    return Boolean(details.state.page);
  } catch {
    await details.close();
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

  constructor(providerId: BridgeProviderId = "chatgpt", settings: BrowserSessionSettings = {}) {
    this.providerId = providerId;
    this.provider = readProvider(providerId);

    const isBrowserChoiceMissing = settings.browserChoice == null;
    if (isBrowserChoiceMissing) {
      this.browserChoice = readConfiguredBrowserChoice();
    } else {
      this.browserChoice = settings.browserChoice;
    }

    const isDebugPortMissing = settings.debugPort == null;
    if (isDebugPortMissing) {
      this.debugPort = BRIDGE_DEBUG_PORT;
    } else {
      this.debugPort = settings.debugPort;
    }

    const isProfileRootMissing = settings.profileRoot == null;
    if (isProfileRootMissing) {
      this.profileRoot = readBridgeChromeProfileRoot();
    } else {
      this.profileRoot = settings.profileRoot;
    }
  }

  private readCdpUrl(): string {
    return createDebugPortUrl(this.debugPort);
  }

  async launch(): Promise<Page> {
    await this.resetSession();

    const isMyChromeBrowserChoice = this.browserChoice === "my-chrome";
    if (isMyChromeBrowserChoice) return await this.attachMyChrome();

    const hasConnectedExisting = await this.connectExisting();
    if (hasConnectedExisting) return this.markAttached();

    return await this.continueLaunch();
  }

  async attach(settings?: {
    readonly attempts?: number;
    readonly intervalMs?: number;
  }): Promise<Page> {
    await this.resetSession();

    const isMyChromeBrowserChoice = this.browserChoice === "my-chrome";
    if (isMyChromeBrowserChoice) return await this.attachMyChrome();

    const hasConnectedExistingWithSettings = await this.connectExisting(settings);
    if (hasConnectedExistingWithSettings) return this.markAttached();

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
    const isPageUnusable = !this.ownsPage || page == null;
    if (isPageUnusable) return;

    this.ownsPage = false;
    await Promise.allSettled([page.close()]);
  }

  async close(): Promise<void> {
    await this.closeOwnTab();
    const browser = this.browser;
    this.page = null;
    this.context = null;
    this.browser = null;

    const isBrowserMissing = browser == null;
    if (isBrowserMissing) return;

    // Shared bridge Chrome must survive CLI process exit / re-attach.
    markCdpDisconnectOnly(browser);
    await closeBrowserWithin(browser);
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

    const isDebugTargetMissing = debugTarget == null;
    if (isDebugTargetMissing) throw writeMyChromeOffError();

    const status = await connectMyChrome(debugTarget.endpoint);
    this.ownsPage = true;
    this.finalizeCdpConnection(status);
    await navigateIfNeeded(status.page, this.provider);
    return this.markAttached();
  }

  private async continueLaunch(): Promise<Page> {
    const versionStatus = await readDebugPortVersionStatus(this.debugPort);
    const myChromeTarget = myChromeDebugTarget();
    assertPortNotHeldByOwnChrome(this.debugPort, myChromeTarget, versionStatus);

    const isDebugPortOpenNow = await isDebugPortListening({ port: this.debugPort });
    if (isDebugPortOpenNow) {
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

  private readCdpStatus(): CdpConnectStatus {
    return { browser: this.browser, context: this.context, page: this.page };
  }

  private applyCdpStatus(status: CdpConnectStatus): void {
    this.browser = status.browser;
    this.context = status.context;
    this.page = status.page;
  }

  private async connectExisting(settings?: {
    readonly attempts?: number;
    readonly intervalMs?: number;
  }): Promise<boolean> {
    const cdpStatus = this.readCdpStatus();

    const connected = await tryConnectOverCdp({
      state: cdpStatus,
      provider: this.provider,
      cdpUrl: this.readCdpUrl(),
      attempts: settings?.attempts,
      intervalMs: settings?.intervalMs,
      isPortListening: () => isDebugPortListening({ port: this.debugPort }),
      close: () => this.close(),
    });
    const isNotConnected = !connected;
    if (isNotConnected) return false;

    this.finalizeCdpConnection(cdpStatus);

    if (cdpStatus.page) void navigateIfNeeded(cdpStatus.page, this.provider);

    return true;
  }

  private finalizeCdpConnection(status: CdpConnectStatus): void {
    this.applyCdpStatus(status);

    const { context: profile, page } = status;
    const isConnectionIncomplete = !profile || page == null;
    if (isConnectionIncomplete) return;

    wireSafeDialogHandlersInProfile(profile);
    interceptChatGptConversationList(profile, this.providerId, this.conversations);
  }
}
