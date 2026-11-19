import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import { writeMyChromeConnectError } from "@/browser/browser-session-errors.ts";
import { markCdpDisconnectOnly } from "@/browser/cdp-connection.ts";

// Your own Chrome asks you to click Allow on every connection, so wait for that click.
const MY_CHROME_ALLOW_TIMEOUT_MILLISECONDS = 60_000;

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
export async function connectMyChrome(endpoint: string): Promise<MyChromeStatus> {
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

export type MyChromeStatus = { browser: Browser; profile: BrowserContext; page: Page };
