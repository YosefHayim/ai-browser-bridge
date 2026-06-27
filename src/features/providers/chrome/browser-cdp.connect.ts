import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import type { BrowserProvider } from "../browser-provider.types.ts";
import { CDP_URL } from "./browser-manager.constants.ts";
import { sleep } from "./chrome-debug.ts";

/** Mutable CDP connection state shared between connect helpers. */
export interface CdpConnectState {
  browser: Browser | null;
  context: BrowserContext | null;
  page: Page | null;
}

interface TryConnectInput {
  state: CdpConnectState;
  provider: BrowserProvider;
  attempts?: number;
  intervalMs?: number;
  isPortListening: () => Promise<boolean>;
  close: () => Promise<void>;
}

/** Retry CDP attach until a provider page is available. */
export async function tryConnectOverCdp(input: TryConnectInput): Promise<boolean> {
  const attempts = input.attempts ?? 8;
  const intervalMs = input.intervalMs ?? 400;
  for (let i = 0; i < attempts; i++) {
    if (!(await input.isPortListening())) {
      if (i < attempts - 1) await sleep({ ms: intervalMs });
      continue;
    }
    if (await connectOnce(input)) return true;
    if (i < attempts - 1) await sleep({ ms: intervalMs });
  }
  return false;
}

async function connectOnce(input: TryConnectInput): Promise<boolean> {
  try {
    input.state.browser = await chromium.connectOverCDP(CDP_URL);
    await assignProviderPage(input);
    return Boolean(input.state.page);
  } catch {
    await input.close();
    return false;
  }
}

async function assignProviderPage(input: TryConnectInput): Promise<void> {
  const found = findProviderPage({ browser: input.state.browser!, provider: input.provider });
  if (found) {
    input.state.context = found.context;
    input.state.page = found.page;
    console.error(`  Connected to running Chrome, found ${input.provider.origin} tab.`);
    return;
  }
  input.state.context = input.state.browser!.contexts()[0]!;
  input.state.page = await input.state.context.newPage();
  console.error(`  Connected to running Chrome, no ${input.provider.origin} tab — opening one.`);
}

interface FindPageInput {
  browser: Browser;
  provider: BrowserProvider;
}

/** Search all browser contexts for a tab showing the provider origin. */
export function findProviderPage(input: FindPageInput): { context: BrowserContext; page: Page } | null {
  for (const ctx of input.browser.contexts()) {
    for (const page of ctx.pages()) {
      if (page.url().includes(input.provider.origin)) return { context: ctx, page };
    }
  }
  return null;
}

interface NavigateInput {
  page: Page;
  provider: BrowserProvider;
}

/** Navigate to the provider when needed and wait for the composer. */
export async function navigateIfNeeded(input: NavigateInput): Promise<void> {
  if (!input.page.url().includes(input.provider.origin)) {
    await input.page.goto(input.provider.defaultUrl, { waitUntil: "domcontentloaded" });
  }
  await input.page.waitForSelector(input.provider.composerSelector, { timeout: 30_000 }).catch(() => {});
}
