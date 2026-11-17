import { mkdirSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser, BrowserContext, Page, Response } from "playwright";
import { chromium } from "playwright";
import {
  BROWSER_CHOICE_ENVIRONMENT,
  type MyChromeDebugTarget,
  readBridgeChromeProfileRoot,
  readBrowserChoiceSetting,
  readChromeAppName,
  readMyChromeDebugTarget,
} from "@/browser/browser-profile.ts";
import type { BrowserChoice } from "@/browser/browser-schemas.ts";
import type { Conversation } from "@/message-types.ts";
import { isChromeInProcessList, listChromeProcesses } from "@/operating-system/chrome-processes.ts";
import { launchChrome } from "@/operating-system/launch-chrome.ts";
import { readOperatingSystem } from "@/operating-system/read-operating-system.ts";
import type { BridgeProviderId } from "@/provider-settings.ts";
import type { ProviderProfile } from "@/providers/engine/browser-provider.ts";
import { readProviderIdForUrl, readProviderProfile } from "@/providers/providers.ts";

const MY_CHROME_BROWSER_CHOICE = "my-chrome";

const CHATGPT_PROVIDER_ID = "chatgpt";

const DOM_LOADED_WAIT_UNTIL = "domcontentloaded";

const CONNECT_ATTEMPT_COUNT = 20;

const RETRY_INTERVAL_MILLISECONDS = 500;

export const BRIDGE_DEBUG_PORT = 9222;
// Your own Chrome asks you to click Allow on every connection, so wait for that click.
const MY_CHROME_ALLOW_TIMEOUT_MILLISECONDS = 60_000;

// Windows quotes a profile path that has spaces: --user-data-dir="C:\\Users\\a b".
const USER_PROFILE_DIRECTORY_FLAG = /--user-data-dir=(?:"(?<quotedDir>[^"]+)"|(?<userDataDir>\S+))/;

function readUserProfileDirectory(commandLine: string): string | null {
  const flagGroups = USER_PROFILE_DIRECTORY_FLAG.exec(commandLine)?.groups;
  return flagGroups?.quotedDir ?? flagGroups?.userDataDir ?? null;
}

// localhost resolves to IPv4 or IPv6, since Chrome can listen only on [::1].
function createDebugPortUrl(port: number): string {
  return `http://localhost:${port}`;
}

export async function getUserProfileDirectoryOnDebugPort(
  port: number = BRIDGE_DEBUG_PORT,
): Promise<string | null> {
  try {
    const chromeProcesses = await listChromeProcesses();
    const remoteDebuggingPortArg = `--remote-debugging-port=${port}`;
    for (const { commandLine } of chromeProcesses) {
      const isDebugPortArgMissingFromLine = !commandLine.includes(remoteDebuggingPortArg);
      if (isDebugPortArgMissingFromLine) continue;

      const userProfileDirectory = readUserProfileDirectory(commandLine);

      const isUserDirectoryMissing = userProfileDirectory == null;
      if (isUserDirectoryMissing) continue;

      return userProfileDirectory;
    }
    return null;
  } catch {
    return null;
  }
}

export function isSameProfile(expected: string, actual: string): boolean {
  function readRealPath(field: string): string {
    try {
      const absolutePath = resolve(field);
      return realpathSync(absolutePath);
    } catch {
      return resolve(field);
    }
  }

  return readRealPath(expected) === readRealPath(actual);
}

const debugPortCloseWaitMilliseconds = 10_000;

async function waitForDebugPortClosed(
  port: number,
  maxWaitMilliseconds = debugPortCloseWaitMilliseconds,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMilliseconds) {
    const isPortListening = await isDebugPortListening({ port });

    const isDebugPortClosed = !isPortListening;
    if (isDebugPortClosed) return true;

    const debugPortClosePollMilliseconds = 250;

    await sleep(debugPortClosePollMilliseconds);
  }
  return false;
}

async function listBridgeChromePids(port: number, profileRoot: string): Promise<number[]> {
  const chromeProcesses = await listChromeProcesses();
  const portSwitch = new RegExp(`--remote-debugging-port=${port}( |$)`);
  const pids: number[] = [];
  for (const { pid, commandLine } of chromeProcesses) {
    const isPortSwitchMissing = !portSwitch.test(commandLine);
    if (isPortSwitchMissing) continue;

    const userProfileDirectory = readUserProfileDirectory(commandLine);

    const isProfileNotMatched =
      userProfileDirectory == null || !isSameProfile(profileRoot, userProfileDirectory);
    if (isProfileNotMatched) continue;

    pids.push(pid);
  }
  return pids;
}

// Your own Chrome can hold the bridge port; it counts as the bridge's only when run from the bridge profile.
export async function terminateChromeOnDebugPort(
  port: number = BRIDGE_DEBUG_PORT,
  profileRoot: string = readBridgeChromeProfileRoot(),
): Promise<boolean> {
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
    throw new Error(`Asked the bridge Chrome to quit, but debug port ${port} is still open.`);
  }

  return true;
}

export async function isDebugPortListening(
  details: { readonly port?: number } = {},
): Promise<boolean> {
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
}

export async function isChromeProcessRunning(
  details: { readonly appName?: string } = {},
): Promise<boolean> {
  let appName = readChromeAppName();

  const hasAppName = details.appName != null;
  if (hasAppName) {
    appName = details.appName;
  }

  const operatingSystem = readOperatingSystem();
  try {
    const chromeProcesses = await listChromeProcesses(operatingSystem);
    return isChromeInProcessList({ chromeProcesses, operatingSystem, macosAppName: appName });
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((fulfillSleep) => setTimeout(fulfillSleep, ms));
}

const debugPortWaitMilliseconds = 30_000;

async function waitForDebugPort(
  port: number,
  maxWaitMilliseconds = debugPortWaitMilliseconds,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMilliseconds) {
    const isDebugPortOpen = await isDebugPortListening({ port });
    if (isDebugPortOpen) return;

    await sleep(RETRY_INTERVAL_MILLISECONDS);
  }
  throw new Error(`Timed out waiting for Chrome debug port ${port}`);
}

type BrowserSessionSettings = {
  readonly debugPort?: number;
  readonly profileRoot: string | null;
  readonly browserChoice?: BrowserChoice;
};

export function listChromeLaunchArgumentList(
  defaultUrl: string,
  profileRoot: string = readBridgeChromeProfileRoot(),
  port: number = BRIDGE_DEBUG_PORT,
): string[] {
  return [
    `--remote-debugging-port=${port}`,
    // Chrome 136+ rejects CDP clients without an explicit allowlist.
    "--remote-allow-origins=*",
    `--user-data-dir=${profileRoot}`,
    "--no-first-run",
    "--no-default-browser-check",
    // Extension workers crash Playwright's connectOverCDP, and sign-in lives in cookies, so extensions are disabled.
    "--disable-extensions",
    "--disable-component-extensions-with-background-pages",
    // Claude Design runs its agent loop inside the tab, so a throttled background tab stalls the turn.
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    defaultUrl,
  ];
}

function spawnChrome(
  defaultUrl: string,
  profileRoot: string = readBridgeChromeProfileRoot(),
  port: number = BRIDGE_DEBUG_PORT,
): void {
  mkdirSync(profileRoot, { recursive: true });

  launchChrome({ args: listChromeLaunchArgumentList(defaultUrl, profileRoot, port) });
}

function attachOnlyError(port: number): Error {
  return new Error(
    `No Chrome listening on debug port ${port}. Run \`bridge chrome start\` before using browser automation.`,
  );
}

// Drop the CDP websocket on close: Browser.close would quit the shared bridge profile.
function markCdpDisconnectOnly(browser: Browser): void {
  // Playwright internal flag — true for connect(), false for connectOverCDP.
  (browser as Browser & { _shouldCloseConnectionOnClose?: boolean })._shouldCloseConnectionOnClose =
    true;
}

const BROWSER_CLOSE_TIMEOUT_MILLISECONDS = 5_000;

// TypeScript cannot see the timer set in the Promise callback; this predicate narrows it.
function isTimerStarted(timer: NodeJS.Timeout | null): timer is NodeJS.Timeout {
  return timer != null;
}

// browser.close() on a connectOverCDP browser can wait for a closed event that never comes.
export async function closeBrowserWithin(
  browser: Pick<Browser, "close">,
  timeoutMilliseconds: number = BROWSER_CLOSE_TIMEOUT_MILLISECONDS,
): Promise<void> {
  let timer: NodeJS.Timeout | null = null;
  const timedOut = new Promise<void>((fulfillTimeout) => {
    timer = setTimeout(fulfillTimeout, timeoutMilliseconds);
  });

  try {
    await Promise.race([browser.close(), timedOut]);
  } catch {
    // Already-closed / transport-gone errors on disconnect: the browser is gone, so log and go on.
    console.error("  Browser was already closed on disconnect.");
  } finally {
    if (isTimerStarted(timer)) clearTimeout(timer);
  }
}

async function readDebugPortVersionStatus(port: number): Promise<number | null> {
  try {
    const versionReply = await fetch(`http://127.0.0.1:${port}/json/version`);
    return versionReply.status;
  } catch {
    return null;
  }
}

// DevToolsActivePort outlives the toggle, so a port that answers without the bridge is not ours.
export function assertPortNotHeldByOwnChrome(
  port: number,
  ownChromeTarget: MyChromeDebugTarget | null,
  versionStatus: number | null,
): void {
  const isOwnChromeOnOtherPort = ownChromeTarget?.port !== port;
  if (isOwnChromeOnOtherPort) return;

  const httpStatusOk = 200;

  const isVersionCheckSettled = versionStatus == null || versionStatus === httpStatusOk;
  if (isVersionCheckSettled) return;

  throw new Error(
    `Your own Chrome is using port ${port} for remote debugging, so the bridge Chrome cannot use it. Set ${BROWSER_CHOICE_ENVIRONMENT}=my-chrome to use your own Chrome, or turn off remote debugging at chrome://inspect/#remote-debugging.`,
  );
}

function spawnReadyError(port: number): Error {
  return new Error(`Chrome started but debug port ${port} did not become ready.`);
}

function createAttachFailedError(details: {
  readonly port: number;
  readonly portOwnerProfileRoot: string | null;
  readonly cause: unknown;
}): Error {
  const hasPortOwnerProfile = details.portOwnerProfileRoot != null;
  if (!hasPortOwnerProfile) {
    return new Error(
      `Chrome debug port ${details.port} is open but the bridge could not attach. Run \`bridge status\` to inspect the Chrome owner.`,
      { cause: details.cause },
    );
  }

  return new Error(
    `Chrome debug port ${details.port} is open but the bridge could not attach. The Chrome on that port uses profile ${details.portOwnerProfileRoot}. Run \`bridge status\` to inspect the Chrome owner.`,
    { cause: details.cause },
  );
}

function writeMyChromeOffError(): Error {
  return new Error(
    "Remote debugging is off in your Chrome. Turn it on at chrome://inspect/#remote-debugging, then run the command again and click Allow.",
  );
}

function writeMyChromeConnectError(cause: unknown): Error {
  const reason = String(cause);
  return new Error(
    `Could not connect to your Chrome. Click Allow when Chrome asks, and keep remote debugging on at chrome://inspect/#remote-debugging. (${reason})`,
  );
}

async function connectOverMyChromeEndpoint(endpoint: string): Promise<Browser> {
  try {
    return await chromium.connectOverCDP(endpoint, {
      timeout: MY_CHROME_ALLOW_TIMEOUT_MILLISECONDS,
    });
  } catch (error) {
    throw writeMyChromeConnectError(error);
  }
}

// Always a new tab: the bridge never types into a tab you opened yourself.
async function connectMyChrome(endpoint: string): Promise<MyChromeStatus> {
  const browser = await connectOverMyChromeEndpoint(endpoint);
  markCdpDisconnectOnly(browser);

  const [defaultProfile] = browser.contexts();

  const isDefaultProfileMissing = defaultProfile == null;
  if (isDefaultProfileMissing) {
    await Promise.allSettled([browser.close()]);
    throw new Error("Your Chrome has no profile window the bridge can open a tab in.");
  }

  const page = await defaultProfile.newPage();
  console.error("  Connected to your Chrome, opened a bridge tab.");
  return { browser, profile: defaultProfile, page };
}

type MyChromeStatus = { browser: Browser; profile: BrowserContext; page: Page };

type CdpConnectStatus = {
  browser: Browser | null;
  profile: BrowserContext | null;
  page: Page | null;
};

function findProviderPage(
  browser: Browser,
  provider: ProviderProfile,
): { profile: BrowserContext; page: Page } | null {
  for (const browserProfile of browser.contexts()) {
    for (const page of browserProfile.pages()) {
      const pageUrl = page.url();

      const isPageOnProvider = readProviderIdForUrl(pageUrl) === provider.id;
      if (isPageOnProvider) {
        return { profile: browserProfile, page };
      }
    }
  }
  return null;
}

async function navigatePageToUrl(page: Page, provider: ProviderProfile): Promise<void> {
  wireSafeDialogHandlers(page);

  const pageUrl = page.url();

  const isPageOnOtherProvider = readProviderIdForUrl(pageUrl) !== provider.id;
  if (isPageOnOtherProvider) {
    await page.goto(provider.defaultUrl, { waitUntil: DOM_LOADED_WAIT_UNTIL });
  }

  try {
    const composerWaitMilliseconds = 30_000;

    await page.waitForSelector(provider.composerSelector, { timeout: composerWaitMilliseconds });
  } catch {
    // Composer may still be loading; attach succeeds without it.
    console.error("  Composer not ready yet; attached without it.");
  }
}

const pagesWiredForDialogs = new WeakSet<Page>();

// Dismiss JS alerts/confirms without crashing when CDP races Playwright's dialog manager.
function wireSafeDialogHandlers(page: Page): void {
  const isPageAlreadyWired = pagesWiredForDialogs.has(page);
  if (isPageAlreadyWired) return;

  pagesWiredForDialogs.add(page);
  page.on("dialog", (dialog) => {
    void Promise.allSettled([dialog.dismiss()]);
  });
}

function wireSafeDialogHandlersInProfile(profile: BrowserContext): void {
  for (const page of profile.pages()) wireSafeDialogHandlers(page);
  profile.on("page", (page) => wireSafeDialogHandlers(page));
}

function interceptChatGptConversationList(
  profile: BrowserContext,
  providerId: string,
  conversations: Conversation[],
): void {
  profile.on("response", (httpReply: Response) => {
    const isProviderIdNotChatgpt = providerId !== CHATGPT_PROVIDER_ID;
    if (isProviderIdNotChatgpt) return;

    void captureChatGptConversationList(httpReply, conversations);
  });
}

function readConversationSummaries(
  conversationListDocument: unknown,
): Record<string, unknown>[] | null {
  const isDocumentObjectMissing =
    typeof conversationListDocument !== "object" || conversationListDocument === null;
  if (isDocumentObjectMissing) return null;

  const isConversationListKeyMissing = !("items" in conversationListDocument);
  if (isConversationListKeyMissing) return null;

  const conversationSummaries = conversationListDocument.items;

  const isConversationArrayMissing = !Array.isArray(conversationSummaries);
  if (isConversationArrayMissing) return null;

  return conversationSummaries;
}

async function captureChatGptConversationList(
  httpReply: Response,
  conversations: Conversation[],
): Promise<void> {
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

    const conversationSummaries = readConversationSummaries(conversationListDocument);

    const isConversationSummariesMissing = conversationSummaries == null;
    if (isConversationSummariesMissing) return;

    conversations.splice(
      0,
      conversations.length,
      ...conversationSummaries.map((line: Record<string, unknown>) => {
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
    console.error("  Could not read the conversation list reply; skipped it.");
  }
}

async function tryConnectOverCdp(details: {
  readonly state: CdpConnectStatus;
  readonly provider: ProviderProfile;
  readonly cdpUrl: string;
  readonly attempts?: number;
  readonly intervalMilliseconds?: number;
  readonly isPortListening: () => Promise<boolean>;
  readonly close: () => Promise<void>;
  readonly reportError: (error: unknown) => void;
}): Promise<boolean> {
  let attempts = 8;

  const hasAttempts = details.attempts != null;
  if (hasAttempts) {
    attempts = details.attempts;
  }

  let intervalMilliseconds = 400;

  const hasIntervalMilliseconds = details.intervalMilliseconds != null;
  if (hasIntervalMilliseconds) {
    intervalMilliseconds = details.intervalMilliseconds;
  }

  for (let attempt = 0; attempt < attempts; attempt++) {
    const isPortListening = await details.isPortListening();

    const isPortClosed = !isPortListening;
    if (isPortClosed) {
      const hasAttemptsLeft = attempt < attempts - 1;
      if (hasAttemptsLeft) await sleep(intervalMilliseconds);

      continue;
    }

    const hasConnectedOverCdp = await connectOnceOverCdp(details);
    if (hasConnectedOverCdp) return true;

    const hasRetryAttemptsLeft = attempt < attempts - 1;
    if (hasRetryAttemptsLeft) await sleep(intervalMilliseconds);
  }
  return false;
}

async function connectOnceOverCdp(details: {
  readonly state: CdpConnectStatus;
  readonly provider: ProviderProfile;
  readonly cdpUrl: string;
  readonly close: () => Promise<void>;
  readonly reportError: (error: unknown) => void;
}): Promise<boolean> {
  try {
    details.state.browser = await chromium.connectOverCDP(details.cdpUrl);
    // Disconnect the socket only: a plain close() would quit the shared Chrome.
    markCdpDisconnectOnly(details.state.browser);

    const found = findProviderPage(details.state.browser, details.provider);

    const isProviderPageFound = found != null;
    if (isProviderPageFound) {
      details.state.profile = found.profile;
      details.state.page = found.page;
      console.error(`  Connected to running Chrome, found ${details.provider.origin} tab.`);
    } else {
      const [firstProfile] = details.state.browser.contexts();

      const isFirstProfileMissing = firstProfile == null;
      if (isFirstProfileMissing) {
        await details.close();
        return false;
      }

      details.state.profile = firstProfile;
      details.state.page = await firstProfile.newPage();
      console.error(
        `  Connected to running Chrome, no ${details.provider.origin} tab — opening one.`,
      );
    }

    return Boolean(details.state.page);
  } catch (error) {
    details.reportError(error);
    await details.close();
    return false;
  }
}

export class BrowserSession {
  private browser: Browser | null = null;
  private profile: BrowserContext | null = null;
  private page: Page | null = null;
  private conversations: Conversation[] = [];
  private readonly providerId: BridgeProviderId;
  private readonly provider: ProviderProfile;
  private readonly debugPort: number;
  private readonly profileRoot: string;
  private readonly browserChoice: BrowserChoice;
  private ownsPage = false;
  private lastCdpError: unknown = null;
  readonly attachedViaCdp = { value: false };
  readonly spawnedNew = { value: false };

  constructor(
    providerId: BridgeProviderId = CHATGPT_PROVIDER_ID,
    settings: BrowserSessionSettings,
  ) {
    this.providerId = providerId;
    this.provider = readProviderProfile(providerId);

    const isBrowserChoiceMissing = settings.browserChoice == null;
    if (isBrowserChoiceMissing) {
      this.browserChoice = readBrowserChoiceSetting();
    } else {
      this.browserChoice = settings.browserChoice;
    }

    const isDebugPortMissing = settings.debugPort == null;
    if (isDebugPortMissing) {
      this.debugPort = BRIDGE_DEBUG_PORT;
    } else {
      this.debugPort = settings.debugPort;
    }

    this.profileRoot = settings.profileRoot ?? readBridgeChromeProfileRoot();
  }

  private readCdpUrl = (): string => {
    return createDebugPortUrl(this.debugPort);
  };

  launch = async (): Promise<Page> => {
    await this.resetSession();

    const isMyChromeBrowserChoice = this.browserChoice === MY_CHROME_BROWSER_CHOICE;
    if (isMyChromeBrowserChoice) return await this.attachMyChrome();

    const hasConnectedExisting = await this.connectExisting();
    if (hasConnectedExisting) return this.markAttached();

    return await this.continueLaunch();
  };

  attach = async (settings?: {
    readonly attempts?: number;
    readonly intervalMilliseconds?: number;
  }): Promise<Page> => {
    await this.resetSession();

    const isMyChromeBrowserChoice = this.browserChoice === MY_CHROME_BROWSER_CHOICE;
    if (isMyChromeBrowserChoice) return await this.attachMyChrome();

    const hasConnectedExistingWithSettings = await this.connectExisting(settings);
    if (hasConnectedExistingWithSettings) return this.markAttached();

    throw attachOnlyError(this.debugPort);
  };

  // Each parallel conversation gets its own tab, so concurrent tasks never share one.
  openTab = async (url: string): Promise<Page> => {
    const profile = this.profile;

    const isThereNoProfile = profile == null;

    if (isThereNoProfile) throw new Error("Browser not launched. Call launch() or attach() first.");

    const page = await profile.newPage();
    wireSafeDialogHandlers(page);
    const pageLoadWaitMilliseconds = 30_000;

    await page.goto(url, {
      waitUntil: DOM_LOADED_WAIT_UNTIL,
      timeout: pageLoadWaitMilliseconds,
    });
    return page;
  };

  getPage = (): Page => {
    const currentPage = this.page;

    const isPageMissing = currentPage == null;
    if (isPageMissing) throw new Error("Browser not launched. Call launch() first.");

    return currentPage;
  };

  // Your own Chrome keeps running; only the tab the bridge opened in it goes away.
  closeOwnTab = async (): Promise<void> => {
    const page = this.page;

    const isPageUnusable = !this.ownsPage || page == null;
    if (isPageUnusable) return;

    this.ownsPage = false;
    await Promise.allSettled([page.close()]);
  };

  close = async (): Promise<void> => {
    await this.closeOwnTab();
    const browser = this.browser;
    this.page = null;
    this.profile = null;
    this.browser = null;

    const isBrowserMissing = browser == null;
    if (isBrowserMissing) return;

    // Shared bridge Chrome must survive CLI process exit / re-attach.
    markCdpDisconnectOnly(browser);
    await closeBrowserWithin(browser);
    this.attachedViaCdp.value = false;
  };

  private resetSession = async (): Promise<void> => {
    const hasLaunchedBrowser = this.profile != null || this.browser != null;
    if (hasLaunchedBrowser) await this.close();
  };

  private markAttached = (): Page => {
    this.attachedViaCdp.value = true;
    return this.getPage();
  };

  private attachMyChrome = async (): Promise<Page> => {
    const debugTarget = readMyChromeDebugTarget();

    const isDebugTargetMissing = debugTarget == null;
    if (isDebugTargetMissing) throw writeMyChromeOffError();

    const status = await connectMyChrome(debugTarget.endpoint);
    this.ownsPage = true;
    this.finalizeCdpConnection(status);
    await navigatePageToUrl(status.page, this.provider);
    return this.markAttached();
  };

  private continueLaunch = async (): Promise<Page> => {
    const versionStatus = await readDebugPortVersionStatus(this.debugPort);
    const myChromeTarget = readMyChromeDebugTarget();
    assertPortNotHeldByOwnChrome(this.debugPort, myChromeTarget, versionStatus);

    const isDebugPortOpenNow = await isDebugPortListening({ port: this.debugPort });
    if (isDebugPortOpenNow) return await this.connectOpeningWindowIfNeeded();

    return await this.runSpawnAndConnect();
  };

  // Chrome with a debug port but no window cannot be attached to; a window makes it attachable.
  private connectOpeningWindowIfNeeded = async (): Promise<Page> => {
    const isConnectedBeforeWindow = await this.connectWithRetries();
    if (isConnectedBeforeWindow) return this.getPage();

    const portOwnerProfileRoot = await getUserProfileDirectoryOnDebugPort(this.debugPort);
    const isPortOwnerKnown = portOwnerProfileRoot != null;
    const isPortOwnedByBridgeProfile =
      isPortOwnerKnown && isSameProfile(this.profileRoot, portOwnerProfileRoot);

    if (!isPortOwnedByBridgeProfile) {
      throw createAttachFailedError({
        port: this.debugPort,
        portOwnerProfileRoot,
        cause: this.lastCdpError,
      });
    }

    console.error(
      "  Chrome has its debug port but no window. Opening a window in the bridge profile.",
    );
    spawnChrome(this.provider.defaultUrl, this.profileRoot, this.debugPort);

    const isConnectedAfterWindow = await this.connectWithRetries();
    if (isConnectedAfterWindow) return this.getPage();

    throw createAttachFailedError({
      port: this.debugPort,
      portOwnerProfileRoot,
      cause: this.lastCdpError,
    });
  };

  private connectWithRetries = async (): Promise<boolean> => {
    return await this.connectExisting({
      attempts: CONNECT_ATTEMPT_COUNT,
      intervalMilliseconds: RETRY_INTERVAL_MILLISECONDS,
    });
  };

  private runSpawnAndConnect = async (): Promise<Page> => {
    console.error("  Launching Chrome with bridge debug port using the shared bridge profile.");
    spawnChrome(this.provider.defaultUrl, this.profileRoot, this.debugPort);
    this.spawnedNew.value = true;
    console.error("  Waiting for Chrome debug port...");
    await waitForDebugPort(this.debugPort);

    const connected = await this.connectWithRetries();
    const isNotConnected = !connected;

    const isPageMissing = this.page == null;
    const isChromeNotReady = isNotConnected || isPageMissing;
    if (isChromeNotReady) throw spawnReadyError(this.debugPort);

    return this.getPage();
  };

  private readCdpStatus = (): CdpConnectStatus => {
    return { browser: this.browser, profile: this.profile, page: this.page };
  };

  private applyCdpStatus = (status: CdpConnectStatus): void => {
    this.browser = status.browser;
    this.profile = status.profile;
    this.page = status.page;
  };

  private connectExisting = async (settings?: {
    readonly attempts?: number;
    readonly intervalMilliseconds?: number;
  }): Promise<boolean> => {
    const cdpStatus = this.readCdpStatus();

    const cdpUrl = this.readCdpUrl();
    this.lastCdpError = null;
    const connected = await tryConnectOverCdp({
      state: cdpStatus,
      provider: this.provider,
      cdpUrl,
      attempts: settings?.attempts,
      intervalMilliseconds: settings?.intervalMilliseconds,
      isPortListening: () => isDebugPortListening({ port: this.debugPort }),
      close: () => this.close(),
      reportError: (error) => {
        this.lastCdpError = error;
      },
    });

    const isNotConnected = !connected;
    if (isNotConnected) return false;

    this.finalizeCdpConnection(cdpStatus);

    const cdpPage = cdpStatus.page;

    const hasCdpPage = cdpPage != null;
    if (hasCdpPage) void navigatePageToUrl(cdpPage, this.provider);

    return true;
  };

  private finalizeCdpConnection = (status: CdpConnectStatus): void => {
    this.applyCdpStatus(status);

    const { profile, page } = status;

    const isConnectionIncomplete = !profile || page == null;
    if (isConnectionIncomplete) return;

    wireSafeDialogHandlersInProfile(profile);
    interceptChatGptConversationList(profile, this.providerId, this.conversations);
  };
}
