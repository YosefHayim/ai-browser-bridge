import type { Locator, Page } from "playwright";
import {
  chatGptConversationUrlFromIdOrUrl,
  isSameChatGptConversation,
} from "../chatgptConversationUrl.ts";
import { SELECTORS, waitForGenerationIdle } from "./chatgptControls.ts";

type SidebarConversationEntry = {
  id: string;
  title: string;
  url: string;
};

type ParseSidebarLinkContext = {
  link: Locator;
  orphans: boolean;
};

type SidebarConversationLink = {
  href: string | null;
  title: string;
  ariaLabel: string | null;
};

type SidebarScanElement = HTMLElement & {
  __bridgeOrphanScan?: {
    originalScrollTop: number;
    links: Map<string, SidebarConversationLink>;
  };
};

export const navigateToConversation = async (page: Page, url: string): Promise<void> => {
  const targetUrl = chatGptConversationUrlFromIdOrUrl(url);
  if (isSameChatGptConversation(page.url(), targetUrl)) {
    await page
      .waitForSelector("#prompt-textarea, [contenteditable]", { timeout: 30_000 })
      .catch(() => {});
    return;
  }
  await waitForGenerationIdle(page);
  await page.goto(targetUrl);
  await page.waitForSelector("#prompt-textarea, [contenteditable]", { timeout: 30_000 });
};

export const newConversation = async (page: Page): Promise<void> => {
  await page.goto("https://chatgpt.com/");
  await page.waitForSelector("#prompt-textarea, [contenteditable]", { timeout: 30_000 });
};

export const parseChatGptSidebarConversationLink = (
  link: SidebarConversationLink,
  options: { readonly orphans?: boolean } = {},
): SidebarConversationEntry | null => {
  const href = link.href === null ? "" : link.href.trim();
  const title = link.title.trim();
  if (!href || !title) return null;
  const sidebarLabel = link.ariaLabel === null ? "" : link.ariaLabel;
  const outsideLooseChats =
    href.includes("/g/") ||
    /\bchat in project\b/i.test(sidebarLabel) ||
    /\bpinned conversation\b/i.test(sidebarLabel);
  if (options.orphans && outsideLooseChats) return null;
  const parsedUrl = new URL(href, "https://chatgpt.com");
  const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
  const lastPathPart = pathParts.pop();
  const id = lastPathPart === undefined ? "" : lastPathPart;
  if (!id) return null;
  return { id, title, url: parsedUrl.toString() };
};

const parseSidebarLink = async (
  parseSidebarLinkContext: ParseSidebarLinkContext,
): Promise<SidebarConversationEntry | null> => {
  const href = await parseSidebarLinkContext.link.getAttribute("href");
  const title = await parseSidebarLinkContext.link.innerText();
  const ariaLabel = await parseSidebarLinkContext.link.getAttribute("aria-label");
  return parseChatGptSidebarConversationLink(
    { href, title, ariaLabel },
    { orphans: parseSidebarLinkContext.orphans },
  );
};

const scanOrphanSidebarConversations = async (page: Page): Promise<SidebarConversationEntry[]> => {
  await page
    .locator(`${SELECTORS.sidebarConversation}:not([aria-label*="pinned conversation" i])`)
    .first()
    .waitFor({ state: "attached", timeout: 10_000 })
    .catch(() => {});
  const sidebar = page.locator('nav[aria-label="Chat history"]').first();
  if ((await sidebar.count()) === 0) return [];
  const collectScrollAndReadState = (element: SidebarScanElement) => {
    const scan = element.__bridgeOrphanScan;
    if (!scan) throw new Error("ChatGPT sidebar scan was not initialized.");
    const sidebarRect = element.getBoundingClientRect();
    for (const link of element.querySelectorAll<HTMLAnchorElement>('a[href^="/c/"]')) {
      const linkRect = link.getBoundingClientRect();
      if (linkRect.bottom < sidebarRect.top || linkRect.top > sidebarRect.bottom) continue;
      const href = link.getAttribute("href");
      if (!href) continue;
      let title = link.innerText;
      if (!title) {
        const textContent = link.textContent;
        title = textContent === null ? "" : textContent;
      }
      scan.links.set(href, {
        href,
        title,
        ariaLabel: link.getAttribute("aria-label"),
      });
    }
    const state = {
      size: scan.links.size,
      scrollHeight: element.scrollHeight,
      atBottom: element.scrollTop + element.clientHeight >= element.scrollHeight - 4,
    };
    const step = Math.max(Math.floor(element.clientHeight * 0.8), 320);
    element.scrollTop = Math.min(element.scrollTop + step, element.scrollHeight);
    return state;
  };
  await sidebar.evaluate((element: SidebarScanElement) => {
    element.__bridgeOrphanScan = {
      originalScrollTop: element.scrollTop,
      links: new Map(),
    };
    element.scrollTop = 0;
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 250));
  let stableBottomPasses = 0;
  let links: SidebarConversationLink[] = [];
  try {
    let reachedStableBottom = false;
    let before = await sidebar.evaluate(collectScrollAndReadState);
    for (let pass = 0; pass < 240; pass += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
      const after = await sidebar.evaluate(collectScrollAndReadState);
      const unchanged =
        after.atBottom &&
        after.size === before.size &&
        after.scrollHeight <= before.scrollHeight + 1;
      stableBottomPasses = unchanged ? stableBottomPasses + 1 : 0;
      if (stableBottomPasses >= 8) {
        reachedStableBottom = true;
        break;
      }
      before = after;
    }
    if (!reachedStableBottom) {
      throw new Error("ChatGPT sidebar scan did not reach the end of the chat history.");
    }
    links = await sidebar.evaluate((element: SidebarScanElement) => {
      const scan = element.__bridgeOrphanScan;
      return scan ? [...scan.links.values()] : [];
    });
  } finally {
    await sidebar
      .evaluate((element: SidebarScanElement) => {
        const scan = element.__bridgeOrphanScan;
        if (scan) element.scrollTop = scan.originalScrollTop;
        delete element.__bridgeOrphanScan;
      })
      .catch(() => {});
  }
  const conversations = new Map<string, SidebarConversationEntry>();
  for (const link of links) {
    const conversation = parseChatGptSidebarConversationLink(link, { orphans: true });
    if (conversation) conversations.set(conversation.id, conversation);
  }
  return [...conversations.values()];
};

const readAllOrphanSidebarConversations = async (
  page: Page,
): Promise<SidebarConversationEntry[]> => {
  const scanPage = await page.context().newPage();
  try {
    await scanPage.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" });
    return await scanOrphanSidebarConversations(scanPage);
  } finally {
    await scanPage.close().catch(() => {});
  }
};

export const readSidebarConversations = async (
  page: Page,
  options: { readonly orphans?: boolean } = {},
): Promise<Array<{ id: string; title: string; url: string }>> => {
  if (options.orphans) return readAllOrphanSidebarConversations(page);
  const links = await page.locator(SELECTORS.sidebarConversation).all();
  const conversations: Array<{ id: string; title: string; url: string }> = [];
  for (const link of links) {
    const entry = await parseSidebarLink({ link, orphans: Boolean(options.orphans) });
    if (entry) conversations.push(entry);
  }
  return conversations;
};
