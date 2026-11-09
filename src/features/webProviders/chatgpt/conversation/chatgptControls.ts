import type { Locator, Page } from "playwright";
import { PROVIDER_CONFIG } from "@/config.ts";
import { GuestSessionError } from "../../providerErrors.ts";
import { waitForResponseIdle } from "../../streaming/streamingGuard.ts";

type ClickFirstVisibleContext = {
  page: Page;
  selectors: readonly string[];
  timeout?: number;
};

type FillFirstVisibleContext = {
  page: import("playwright").Page;
  selectors: readonly string[];
  value: string;
};

type FillVisibleFieldContext = {
  field: Locator;
  value: string;
};

type FirstVisibleInContext = {
  parent: Locator;
  selectors: readonly string[];
};

type FirstVisibleContext = {
  page: Page;
  selectors: readonly string[];
};

/** DOM selectors for ChatGPT's interface. Subject to change if ChatGPT updates UI. */
export const SELECTORS = {
  promptInput: PROVIDER_CONFIG.chatgpt.selectors.composer,

  sendButton:
    'button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send message"]',

  responseBlock: PROVIDER_CONFIG.chatgpt.selectors.assistant,

  lastResponse: `${PROVIDER_CONFIG.chatgpt.selectors.assistant}:last-of-type`,

  sidebarConversation: 'nav a[href^="/c/"]',
  // Streaming indicator (stop button appears while a turn is generating).
  streamingIndicator: [
    'button[aria-label="Stop generating"]',
    'button[aria-label="Stop streaming"]',
    'button[aria-label*="Stop" i]',
    'button[data-testid="stop-button"]',
  ].join(", "),
  /** ChatGPT-generated images render outside the role block, served from the estuary content endpoint. */
  generatedImage: 'img[src*="/backend-api/estuary/content"], img[alt^="Generated image" i]',

  modelTrigger: [
    'button[data-testid="model-switcher-dropdown-button"]',
    'button[aria-label="Switch model"]',
    'button:has-text("GPT")',
    'button:has-text("ChatGPT")',
    'button:has-text("o3")',
    'button:has-text("o4")',
  ],

  openMenu: '[role="menu"], [data-radix-menu-content], [data-radix-popper-content-wrapper]',

  userBlock: '[data-message-author-role="user"]',

  conversationTurn: 'section[data-testid^="conversation-turn-"]',

  attachmentInput: 'input[type="file"]',
  attachmentButton: [
    'button[aria-label*="Attach" i]',
    'button[aria-label*="Upload" i]',
    'button[data-testid*="attach" i]',
    'button[data-testid*="upload" i]',
  ],

  accountMenuButton: [
    '[data-testid="accounts-profile-button"]',
    '[role="button"][aria-label*="open profile menu" i]',
    'button[data-testid="profile-button"]',
    'button[aria-label*="profile" i]',
    'button[aria-label*="account" i]',
    'button[aria-label*="user" i]',
  ],
  settingsEntrypoint: [
    '[role="menuitem"]:has-text("Settings")',
    'button:has-text("Settings")',
    'a:has-text("Settings")',
  ],
} as const;

export const countAssistantResponses = async (page: Page): Promise<number> => {
  return page.locator(SELECTORS.responseBlock).count();
};

export const waitForGenerationIdle = async (page: Page, timeoutMs?: number): Promise<void> => {
  await waitForResponseIdle(page, SELECTORS.streamingIndicator, timeoutMs);
};

export const clickFirstVisible = async (
  clickFirstVisibleContext: ClickFirstVisibleContext,
): Promise<boolean> => {
  const timeout =
    clickFirstVisibleContext.timeout === undefined ? 1_000 : clickFirstVisibleContext.timeout;
  for (const selector of clickFirstVisibleContext.selectors) {
    const locator = clickFirstVisibleContext.page.locator(selector).first();
    await locator.waitFor({ state: "visible", timeout }).catch(() => {});
    if ((await locator.count()) > 0 && (await locator.isVisible().catch(() => false))) {
      try {
        await locator.click({ timeout });
        return true;
      } catch {
        try {
          await locator.click({ timeout, force: true });
          return true;
        } catch {
          // both click attempts failed; fall through to the next candidate locator
        }
      }
    }
  }
  return false;
};

const fillVisibleField = async (
  fillVisibleFieldContext: FillVisibleFieldContext,
): Promise<void> => {
  await fillVisibleFieldContext.field.fill(fillVisibleFieldContext.value);
  await fillVisibleFieldContext.field.dispatchEvent("input").catch(() => {});
  await fillVisibleFieldContext.field.dispatchEvent("change").catch(() => {});
};

export const fillFirstVisible = async (
  fillFirstVisibleContext: FillFirstVisibleContext,
): Promise<boolean> => {
  const field = await firstVisible({
    page: fillFirstVisibleContext.page,
    selectors: fillFirstVisibleContext.selectors,
  });
  if (!field) return false;
  await fillVisibleField({ field, value: fillFirstVisibleContext.value });
  return true;
};

export const firstVisibleIn = async (
  firstVisibleInContext: FirstVisibleInContext,
): Promise<Locator | null> => {
  for (const selector of firstVisibleInContext.selectors) {
    const locator = firstVisibleInContext.parent.locator(selector).first();
    if ((await locator.count()) > 0 && (await locator.isVisible().catch(() => false))) {
      return locator;
    }
  }
  return null;
};

export const firstVisible = async (
  firstVisibleContext: FirstVisibleContext,
): Promise<Locator | null> => {
  for (const selector of firstVisibleContext.selectors) {
    const locator = firstVisibleContext.page.locator(selector).first();
    if ((await locator.count()) > 0 && (await locator.isVisible().catch(() => false))) {
      return locator;
    }
  }
  return null;
};

export const normalizeDisplayText = (value: string): string => {
  return value
    .replace(/\s+/g, " ")
    .replace(/\b(current|selected)\b/gi, "")
    .trim();
};

export const waitForComposerReady = async (page: Page): Promise<void> => {
  await page.waitForSelector(SELECTORS.promptInput, { timeout: 15_000 }).catch(() => {});
};

export const assertSignedIn = async (page: Page): Promise<void> => {
  if (await isGuestSession(page)) {
    throw new GuestSessionError({
      providerId: "chatgpt",
      reason:
        "Run `bridge chrome start --provider chatgpt`, click Log in if needed, complete sign-in, leave Chrome open, then run again.",
    });
  }
};

const hasGuestLoginButtons = async (page: Page): Promise<boolean> => {
  const login = page.locator('[data-testid="login-button"]');
  if (await login.isVisible({ timeout: 1500 }).catch(() => false)) return true;
  const signup = page.locator('[data-testid="signup-button"]');
  return signup.isVisible({ timeout: 500 }).catch(() => false);
};

const hasVisibleAccountMenu = async (page: Page): Promise<boolean> => {
  const account = page.locator(SELECTORS.accountMenuButton.join(", "));
  return account
    .first()
    .isVisible({ timeout: 2500 })
    .catch(() => false);
};

const hasVisibleComposer = async (page: Page): Promise<boolean> => {
  const prompt = page.locator(SELECTORS.promptInput);
  return prompt
    .first()
    .isVisible({ timeout: 1500 })
    .catch(() => false);
};

const isGuestSession = async (page: Page): Promise<boolean> => {
  if (await hasVisibleAccountMenu(page)) return false;
  if (await hasGuestLoginButtons(page)) return true;
  return !(await hasVisibleComposer(page));
};
