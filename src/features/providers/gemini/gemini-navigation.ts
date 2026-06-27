import type { Page } from "playwright";
import { SELECTORS } from "./selectors.config.ts";

/** Thrown when Gemini shows the unauthenticated sign-in shell. */
export class GuestSessionError extends Error {
  constructor() {
    super(
      "Gemini is not signed in. "
        + "This is the bridge's isolated Chrome — not your daily browser. "
        + "Click Sign in in that window, complete Google sign-in, leave it open, then run again.",
    );
    this.name = "GuestSessionError";
  }
}

/** True when Gemini is showing the unauthenticated shell. */
export async function isGuestSession(page: Page): Promise<boolean> {
  const input = page.locator(SELECTORS.promptInput).first();
  if (await input.isVisible({ timeout: 2500 }).catch(() => false)) return false;
  const signIn = page.locator(SELECTORS.signInButton).first();
  return signIn.isVisible({ timeout: 1500 }).catch(() => true);
}

/** Fail fast before sending a prompt to an unauthenticated session. */
export async function assertSignedIn(page: Page): Promise<void> {
  if (await isGuestSession(page)) throw new GuestSessionError();
}

/** Read the conversation list from Gemini's sidebar when available. */
export async function readSidebarConversations(page: Page): Promise<Array<{ id: string; title: string; url: string }>> {
  const links = await page.locator(SELECTORS.sidebarConversation).all();
  const conversations: Array<{ id: string; title: string; url: string }> = [];
  for (const link of links) {
    const href = await link.getAttribute("href");
    const title = normalizeDisplayText(await link.innerText().catch(() => ""));
    if (!href || !title) continue;
    conversations.push(buildConversationEntry({ href, title }));
  }
  return conversations;
}

/** Navigate to a specific Gemini conversation by URL. */
export async function navigateToConversation(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForSelector(SELECTORS.promptInput, { timeout: 30_000 });
}

/** Start a new Gemini conversation. */
export async function newConversation(page: Page): Promise<void> {
  await page.goto("https://gemini.google.com/app");
  await page.waitForSelector(SELECTORS.promptInput, { timeout: 30_000 });
}

function normalizeDisplayText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function buildConversationEntry(input: { href: string; title: string }): { id: string; title: string; url: string } {
  const url = input.href.startsWith("http") ? input.href : `https://gemini.google.com${input.href}`;
  const id = input.href.split("/").filter(Boolean).pop() ?? input.href;
  return { id, title: input.title, url };
}
