import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import { wireSafeDialogHandlers } from "@/browser/dialog-handlers.ts";
import { sleep } from "@/browser/sleep.ts";
import type { ProviderProfile } from "@/providers/engine/browser-provider.ts";
import { readProviderIdForUrl } from "@/providers/providers.ts";

export type CdpConnectStatus = {
  browser: Browser | null;
  profile: BrowserContext | null;
  page: Page | null;
};

// Drop the CDP websocket on close: Browser.close would quit the shared bridge profile.
export function markCdpDisconnectOnly(browser: Browser): void {
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

export async function navigatePageToUrl(page: Page, provider: ProviderProfile): Promise<void> {
  wireSafeDialogHandlers(page);

  const pageUrl = page.url();

  const isPageOnOtherProvider = readProviderIdForUrl(pageUrl) !== provider.id;
  if (isPageOnOtherProvider) {
    await page.goto(provider.defaultUrl, { waitUntil: "domcontentloaded" });
  }

  try {
    const composerWaitMilliseconds = 30_000;

    await page.waitForSelector(provider.composerSelector, { timeout: composerWaitMilliseconds });
  } catch {
    // Composer may still be loading; attach succeeds without it.
    console.error("  Composer not ready yet; attached without it.");
  }
}

export async function tryConnectOverCdp(details: {
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
