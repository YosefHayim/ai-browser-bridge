import type { Locator, Page } from "playwright";
import {
  isSameChatGptConversation,
  readChatGptConversationUrlFromIdOrUrl,
} from "@/providers/chatgpt/backend-api/chatgpt-conversation-url.ts";
import { readLooseConversations } from "@/providers/chatgpt/backend-api/chatgpt-loose-conversations.ts";
import {
  CHATGPT_ORIGIN_URL,
  FIFTEEN_SECONDS_MILLISECONDS,
  HREF_ATTRIBUTE,
  SLASH,
} from "@/providers/chatgpt/page/chatgpt-page-constants.ts";
import { ChatGptReplyReader } from "@/providers/chatgpt/page/chatgpt-reply-reader.ts";
import { SELECTORS } from "@/providers/chatgpt/page/chatgpt-selectors.ts";
import { probeOrFallback, readVisibleCopy } from "@/providers/engine/browser-provider.ts";
import { HTML_PARSED_WAIT, VISIBLE_WAIT_MODE } from "@/providers/engine/page-probes.ts";

const THIRTY_SECONDS_MILLISECONDS = 30_000;

const CHATGPT_HOME_URL = "https://chatgpt.com/";

export class ChatGptSidebar {
  constructor(private readonly page: Page) {}

  navigateToConversation = async (url: string): Promise<void> => {
    const targetUrl = readChatGptConversationUrlFromIdOrUrl(url);

    const openPageUrl = this.page.url();
    if (isSameChatGptConversation(openPageUrl, targetUrl)) {
      const thirtySecondsMilliseconds = 30_000;

      await probeOrFallback(null, () =>
        this.page.waitForSelector(SELECTORS.promptInput, {
          state: VISIBLE_WAIT_MODE,
          timeout: thirtySecondsMilliseconds,
        }),
      );
      return;
    }

    await new ChatGptReplyReader(this.page).waitForGenerationIdle();
    await this.page.goto(targetUrl);
    await this.page.waitForSelector(SELECTORS.promptInput, {
      state: VISIBLE_WAIT_MODE,
      timeout: THIRTY_SECONDS_MILLISECONDS,
    });
    await Promise.allSettled([
      this.page
        .locator(SELECTORS.conversationTurn)
        .first()
        .waitFor({ timeout: FIFTEEN_SECONDS_MILLISECONDS }),
    ]);
  };

  openNewConversation = async (): Promise<void> => {
    await this.page.goto(CHATGPT_HOME_URL);
    await this.page.waitForSelector(SELECTORS.promptInput, {
      state: VISIBLE_WAIT_MODE,
      timeout: THIRTY_SECONDS_MILLISECONDS,
    });
  };

  private readLooseConversationsFromScanPage = async (): Promise<SidebarConversationLine[]> => {
    const scanPage = await this.page.context().newPage();

    try {
      await scanPage.goto(CHATGPT_HOME_URL, { waitUntil: HTML_PARSED_WAIT });
      return await readLooseConversations(scanPage);
    } finally {
      await probeOrFallback(null, () => scanPage.close());
    }
  };

  readSidebarConversations = async (
    settings: { readonly orphans?: boolean } = {},
  ): Promise<SidebarConversationLine[]> => {
    const isOrphans = settings.orphans === true;
    if (isOrphans) return this.readLooseConversationsFromScanPage();

    const links = await this.page.locator(SELECTORS.sidebarConversation).all();
    const conversations: SidebarConversationLine[] = [];
    for (const link of links) {
      const line = await parseSidebarLink(link);

      const isParsedLine = line != null;
      if (isParsedLine) conversations.push(line);
    }
    return conversations;
  };
}

type SidebarConversationLine = {
  id: string;
  title: string;
  url: string;
};

type SidebarConversationLink = {
  href: string | null;
  title: string;
};

export function parseChatGptSidebarConversationLink(
  link: SidebarConversationLink,
): SidebarConversationLine | null {
  const href = (link.href ?? "").trim();

  const title = link.title.trim();

  const isLinkIncomplete = !href || !title;
  if (isLinkIncomplete) return null;

  const parsedUrl = new URL(href, CHATGPT_ORIGIN_URL);
  const pathParts = parsedUrl.pathname.split(SLASH).filter(Boolean);
  const lastPathPart = pathParts.pop();

  const isLastPathPartMissing = lastPathPart == null;
  const id = isLastPathPartMissing ? "" : lastPathPart;

  const isIdEmpty = !id;
  if (isIdEmpty) return null;

  return { id, title, url: parsedUrl.toString() };
}

async function parseSidebarLink(link: Locator): Promise<SidebarConversationLine | null> {
  const href = await link.getAttribute(HREF_ATTRIBUTE);
  const title = await readVisibleCopy(link);
  return parseChatGptSidebarConversationLink({ href, title });
}
