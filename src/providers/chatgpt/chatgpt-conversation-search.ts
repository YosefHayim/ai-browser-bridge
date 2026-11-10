import type { Locator, Page, Response } from "playwright";
import { z } from "zod";
import type {
  ConversationSearchDetails,
  ConversationSearchReport,
} from "@/conversation-catalog/conversation-catalog-schemas.ts";
import { readChatGptConversationIdFromUrl } from "./chatgpt-conversation-url.ts";

export const CHATGPT_SEARCH = {
  trigger: 'button[aria-label="Search"]',
  dialog: '[role="dialog"]:has(button[aria-label="Close global search"])',
  input: 'input[role="combobox"]',
  resultLink: 'a[href*="/c/"]',
  resultTitle: '[data-testid="global-search-result-preview-trigger"] + span > span:first-child',
  rateLimit: "#modal-conversation-history-rate-limit",
  searchEndpoint: "/backend-api/global/search",
} as const;

type ChatGptSearchLine = {
  readonly href: string;
  readonly title: string;
};

const SEARCH_REPLY_TIMEOUT_MS = 15_000;
const SEARCH_REPORTS_POLL_MS = 250;
const SEARCH_REPORTS_POLL_COUNT = 12;
const SEARCH_RENDER_POLL_COUNT = 20;
const MAX_UNCHANGED_SCROLLS = 2;

export const readChatGptSearchReport = (
  line: ChatGptSearchLine,
  index: number,
): ConversationSearchReport | undefined => {
  const conversationId = readChatGptConversationIdFromUrl(line.href);

  const title = line.title.trim();
  const isConversationIncomplete = conversationId == null || !title;
  if (isConversationIncomplete) return undefined;

  return {
    id: conversationId,
    title,
    url: new URL(line.href, "https://chatgpt.com").toString(),
    provider: "chatgpt",
    source: "providerSearch",
    score: Math.max(1, 100 - index),
  };
};

const globalSearchRequestSchema = z.object({ query: z.string() });

// Not JSON means the request is not a search request, so the caller sees no match.
const parseReplyOrUndefined = (serializedReply: string): unknown => {
  try {
    return JSON.parse(serializedReply);
  } catch {
    return undefined;
  }
};

type GlobalSearchReplyHit = {
  readonly response: Response;
  readonly query: string;
};

export const isGlobalSearchReplyFor = (hit: GlobalSearchReplyHit): boolean => {
  const replyUrl = new URL(hit.response.url());
  const isSearchEndpointWrong = replyUrl.pathname !== CHATGPT_SEARCH.searchEndpoint;
  if (isSearchEndpointWrong) return false;

  const requestFields = hit.response.request().postData();

  const isThereNoRequestFields = requestFields == null;
  if (isThereNoRequestFields) return false;

  const searchRequestReply = globalSearchRequestSchema.safeParse(
    parseReplyOrUndefined(requestFields),
  );
  return searchRequestReply.success && searchRequestReply.data.query === hit.query;
};

export const assertGlobalSearchSucceeded = (searchReply: Response): void => {
  const isSearchReplyOk = searchReply.ok();
  if (isSearchReplyOk) return;

  const status = searchReply.status();
  throw new Error(`ChatGPT conversation search failed with HTTP ${status}.`);
};

const globalSearchReportsSchema = z.object({
  items: z.array(z.object({ source_type: z.string() })),
});

export const hasConversationHits = (searchReplyFields: unknown): boolean => {
  const searchReportsReply = globalSearchReportsSchema.safeParse(searchReplyFields);

  const isThereNoValidReply = !searchReportsReply.success;
  if (isThereNoValidReply) {
    throw new Error("ChatGPT conversation search returned an unexpected answer.");
  }

  return searchReportsReply.data.items.some(
    (searchReport) => searchReport.source_type === "conversation",
  );
};

type SearchLineQueryHit = {
  readonly entry: ChatGptSearchLine;
  readonly query: string;
};

export const isSearchLineForQuery = (hit: SearchLineQueryHit): boolean => {
  const lineUrl = new URL(hit.entry.href, "https://chatgpt.com");
  return lineUrl.searchParams.get("historySearchQuery") === hit.query;
};

const closeOpenSearch = async (page: Page): Promise<void> => {
  const closeButton = page.getByRole("button", { name: "Close global search", exact: true });
  const closeButtonVisible = await closeButton.isVisible();
  const isCloseButtonHidden = !closeButtonVisible;
  if (isCloseButtonHidden) return;

  await closeButton.evaluate((button) => {
    const isButtonElement = button instanceof HTMLElement;
    if (isButtonElement) button.click();
  });
};

const openChatSearch = async (page: Page): Promise<Locator> => {
  await closeOpenSearch(page);
  const trigger = page.locator(CHATGPT_SEARCH.trigger).filter({ visible: true }).first();
  await trigger.waitFor({ state: "visible", timeout: 8_000 });
  await trigger.evaluate((button) => {
    const isButtonElement = button instanceof HTMLElement;
    if (isButtonElement) button.click();
  });
  const dialog = page.locator(CHATGPT_SEARCH.dialog).first();
  await dialog.waitFor({ state: "visible", timeout: 8_000 });

  const chatsTab = dialog.getByRole("tab", { name: "Chats", exact: true });
  const isChatsTabVisible = await chatsTab.isVisible();
  if (isChatsTabVisible) await chatsTab.click();

  return dialog;
};

const searchLinesIn = async (dialog: Locator): Promise<ChatGptSearchLine[]> => {
  return dialog.locator(CHATGPT_SEARCH.resultLink).evaluateAll(
    (links, titleSelector) =>
      links.flatMap((link) => {
        const href = link.getAttribute("href");

        const isHrefMissing = href == null;
        if (isHrefMissing) return [];

        const titleNode = link.querySelector(titleSelector);
        const isLinkElement = link instanceof HTMLElement;
        const fallbackTitle = isLinkElement ? link.innerText.split("\n")[0] : "";
        let unparsedTitle = fallbackTitle;

        const hasTitleNode = titleNode != null && titleNode.textContent != null;
        if (hasTitleNode) unparsedTitle = titleNode.textContent;

        if (unparsedTitle == null) unparsedTitle = "";

        const title = unparsedTitle.trim();
        return title ? [{ href, title }] : [];
      }),
    CHATGPT_SEARCH.resultTitle,
  );
};

const searchLinesFor = async (dialog: Locator, query: string): Promise<ChatGptSearchLine[]> => {
  const lines = await searchLinesIn(dialog);
  return lines.filter((line) => isSearchLineForQuery({ entry: line, query }));
};

export const dismissChatGptHistoryRateLimit = async (page: Page): Promise<boolean> => {
  const isClosedPage = page.isClosed();
  if (isClosedPage) return false;

  const modal = page.locator(CHATGPT_SEARCH.rateLimit).first();
  const modalVisible = await modal.isVisible();
  const isModalHidden = !modalVisible;
  if (isModalHidden) return false;

  const acknowledge = modal.getByRole("button", { name: "Got it", exact: true }).first();
  const isAcknowledgeVisible = await acknowledge.isVisible();
  if (isAcknowledgeVisible) {
    await acknowledge.evaluate((button) => {
      const isButtonElement = button instanceof HTMLElement;
      if (isButtonElement) button.click();
    });
  }

  try {
    await modal.waitFor({ state: "hidden", timeout: 3_000 });
  } catch {
    // The caller bounds repeated cooldowns if ChatGPT leaves the modal mounted.
  }
  return true;
};

const assertSearchAvailable = async (page: Page): Promise<void> => {
  const isRateLimitVisible = await page.locator(CHATGPT_SEARCH.rateLimit).isVisible();
  const isRateLimitHidden = !isRateLimitVisible;
  if (isRateLimitHidden) return;

  throw new Error(
    "ChatGPT conversation search is temporarily rate-limited. Wait a few minutes and try again.",
  );
};

export const waitForChatGptSearchReports = async (
  page: Page,
  dialog: Locator,
  query: string,
): Promise<void> => {
  for (let poll = 0; poll < SEARCH_RENDER_POLL_COUNT; poll += 1) {
    await assertSearchAvailable(page);
    const queryLines = await searchLinesFor(dialog, query);

    const hasQueryLines = queryLines.length > 0;
    if (hasQueryLines) return;

    await page.waitForTimeout(SEARCH_REPORTS_POLL_MS);
  }
  throw new Error("ChatGPT found matching chats but did not show them in Search.");
};

const scrollSearchReports = async (dialog: Locator): Promise<boolean> => {
  const firstReport = dialog.locator(CHATGPT_SEARCH.resultLink).first();
  const firstReportCount = await firstReport.count();
  const hasNoFirstReport = firstReportCount === 0;
  if (hasNoFirstReport) return false;

  return firstReport.evaluate((reportLink) => {
    const searchDialog = reportLink.closest('[role="dialog"]');
    let scrollCandidate = reportLink.parentElement;
    while (scrollCandidate && searchDialog?.contains(scrollCandidate)) {
      const isScrollable = scrollCandidate.scrollHeight > scrollCandidate.clientHeight + 20;
      if (isScrollable) {
        const previousScrollTop = scrollCandidate.scrollTop;
        scrollCandidate.scrollTo(0, scrollCandidate.scrollHeight);
        return scrollCandidate.scrollTop > previousScrollTop;
      }

      scrollCandidate = scrollCandidate.parentElement;
    }
    return false;
  });
};

const resetSearchReportsScroll = async (dialog: Locator): Promise<void> => {
  const firstReport = dialog.locator(CHATGPT_SEARCH.resultLink).first();
  const firstReportCount = await firstReport.count();
  const hasNoFirstReport = firstReportCount === 0;
  if (hasNoFirstReport) return;

  await firstReport.evaluate((reportLink) => {
    const searchDialog = reportLink.closest('[role="dialog"]');
    let scrollCandidate = reportLink.parentElement;
    while (scrollCandidate && searchDialog?.contains(scrollCandidate)) {
      const isScrollable = scrollCandidate.scrollHeight > scrollCandidate.clientHeight + 20;
      if (isScrollable) {
        scrollCandidate.scrollTo(0, 0);
        return;
      }

      scrollCandidate = scrollCandidate.parentElement;
    }
  });
};

const collectVisibleSearchReports = async (
  dialog: Locator,
  query: string,
  reportsById: Map<string, ConversationSearchReport>,
): Promise<void> => {
  const lines = await searchLinesFor(dialog, query);
  for (const line of lines) {
    const report = readChatGptSearchReport(line, reportsById.size);
    const isHitUnseen = report != null && !reportsById.has(report.id);
    if (isHitUnseen) {
      reportsById.set(report.id, report);
    }
  }
};

interface CollectSearchReportsDetails {
  page: Page;
  dialog: Locator;
  query: string;
  limit: number;
}

const collectSearchReports = async ({
  page,
  dialog,
  query,
  limit,
}: CollectSearchReportsDetails): Promise<ConversationSearchReport[]> => {
  const reportsById = new Map<string, ConversationSearchReport>();
  let unchangedScrolls = 0;
  while (reportsById.size < limit && unchangedScrolls < MAX_UNCHANGED_SCROLLS) {
    await collectVisibleSearchReports(dialog, query, reportsById);

    const isByIdSizeAtLeastLimit = reportsById.size >= limit;
    if (isByIdSizeAtLeastLimit) break;

    const reportCountBeforeScroll = reportsById.size;

    const isScrolled = await scrollSearchReports(dialog);
    const isScrollFailed = !isScrolled;
    if (isScrollFailed) break;

    for (
      let poll = 0;
      poll < SEARCH_REPORTS_POLL_COUNT && reportsById.size === reportCountBeforeScroll;
      poll += 1
    ) {
      await page.waitForTimeout(SEARCH_REPORTS_POLL_MS);
      await collectVisibleSearchReports(dialog, query, reportsById);
    }

    const isReportCountUnchanged = reportsById.size === reportCountBeforeScroll;
    if (isReportCountUnchanged) unchangedScrolls += 1;
    else unchangedScrolls = 0;
  }
  return Array.from(reportsById.values()).slice(0, limit);
};

export const searchChatGptConversations = async (
  page: Page,
  details: ConversationSearchDetails,
): Promise<ConversationSearchReport[]> => {
  const query = details.query.trim();
  const isQueryEmpty = !query;
  if (isQueryEmpty) return [];

  const limit = details.limit == null ? 20 : details.limit;
  try {
    const dialog = await openChatSearch(page);
    await assertSearchAvailable(page);
    const field = dialog.locator(CHATGPT_SEARCH.input).first();
    await field.fill("");
    await field.focus();
    const searchReplyPromise = page.waitForResponse(
      (reply) => isGlobalSearchReplyFor({ response: reply, query }),
      { timeout: SEARCH_REPLY_TIMEOUT_MS },
    );
    await field.pressSequentially(query, { delay: 25 });
    const searchReply = await searchReplyPromise;
    assertGlobalSearchSucceeded(searchReply);

    const searchReplyFields: unknown = await searchReply.json();
    const isNotConversationHitsSearch = !hasConversationHits(searchReplyFields);
    if (isNotConversationHitsSearch) return [];

    await waitForChatGptSearchReports(page, dialog, query);
    await resetSearchReportsScroll(dialog);
    return await collectSearchReports({ page, dialog, query, limit });
  } finally {
    await closeOpenSearch(page);
  }
};
