import type { Browser, BrowserContext, Page } from "playwright";
import {
  getUserProfileDirectoryOnDebugPort,
  isSameProfile,
  spawnChrome,
} from "@/browser/bridge-chrome-processes.ts";
import {
  readBridgeChromeProfileRoot,
  readBrowserChoiceSetting,
  readMyChromeDebugTarget,
} from "@/browser/browser-profile.ts";
import type { BrowserChoice } from "@/browser/browser-schemas.ts";
import {
  attachOnlyError,
  createAttachFailedError,
  spawnReadyError,
  writeMyChromeOffError,
} from "@/browser/browser-session-errors.ts";
import {
  type CdpConnectStatus,
  closeBrowserWithin,
  markCdpDisconnectOnly,
  navigatePageToUrl,
  tryConnectOverCdp,
} from "@/browser/cdp-connection.ts";
import { interceptChatGptConversationList } from "@/browser/chatgpt-conversation-list.ts";
import {
  assertPortNotHeldByOwnChrome,
  BRIDGE_DEBUG_PORT,
  createDebugPortUrl,
  isDebugPortListening,
  readDebugPortVersionStatus,
  waitForDebugPort,
} from "@/browser/chrome-debug-port.ts";
import {
  wireSafeDialogHandlers,
  wireSafeDialogHandlersInProfile,
} from "@/browser/dialog-handlers.ts";
import { connectMyChrome } from "@/browser/my-chrome-connection.ts";
import type { Conversation } from "@/message-types.ts";
import type { BridgeProviderId } from "@/provider-settings.ts";
import type { ProviderProfile } from "@/providers/engine/browser-provider.ts";
import { readProviderProfile } from "@/providers/providers.ts";

const MY_CHROME_BROWSER_CHOICE = "my-chrome";

const CHATGPT_PROVIDER_ID = "chatgpt";

const DOM_LOADED_WAIT_UNTIL = "domcontentloaded";

const CONNECT_ATTEMPT_COUNT = 20;

const RETRY_INTERVAL_MILLISECONDS = 500;
type BrowserSessionSettings = {
  readonly debugPort?: number;
  readonly profileRoot: string | null;
  readonly browserChoice?: BrowserChoice;
};

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
