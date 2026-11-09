import type { Locator, Page, Response } from "playwright";
import { z } from "zod";
import type {
  ConversationSearchInput,
  ConversationSearchResult,
} from "@/conversation-catalog/conversation-catalog-schemas.ts";
import { chatGptConversationIdFromUrl } from "./chatgpt-conversation-url.ts";

export const CHATGPT_SEARCH = {
  trigger: 'button[aria-label="Search"]',
  dialog: '[role="dialog"]:has(button[aria-label="Close global search"])',
  input: 'input[role="combobox"]',
  resultLink: 'a[href*="/c/"]',
  resultTitle: '[data-testid="global-search-result-preview-trigger"] + span > span:first-child',
  rateLimit: "#modal-conversation-history-rate-limit",
  searchEndpoint: "/backend-api/global/search",
} as const;

type ChatGptSearchEntry = {
  readonly href: string;
  readonly title: string;
};

const SEARCH_RESPONSE_TIMEOUT_MS = 15_000;
const SEARCH_RESULTS_POLL_MS = 250;
const SEARCH_RESULTS_POLL_COUNT = 12;
const SEARCH_RENDER_POLL_COUNT = 20;
const MAX_UNCHANGED_SCROLLS = 2;

export const chatGptSearchResultFor = (
  entry: ChatGptSearchEntry,
  index: number,
): ConversationSearchResult | undefined => {
  const conversationId = chatGptConversationIdFromUrl(entry.href);

  const title = entry.title.trim();
  const isConversationIdMissingOrTitleMissing = conversationId === null || !title;
  if (isConversationIdMissingOrTitleMissing) return undefined;

  return {
    id: conversationId,
    title,
    url: new URL(entry.href, "https://chatgpt.com").toString(),
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

type GlobalSearchResponseMatch = {
  readonly response: Response;
  readonly query: string;
};

export const isGlobalSearchResponseFor = (match: GlobalSearchResponseMatch): boolean => {
  const responseUrl = new URL(match.response.url());
  const isSearchEndpointWrong = responseUrl.pathname !== CHATGPT_SEARCH.searchEndpoint;
  if (isSearchEndpointWrong) return false;

  const requestBody = match.response.request().postData();

  const isThereNoRequestBody = requestBody == null;
  if (isThereNoRequestBody) return false;

  const searchRequestReply = globalSearchRequestSchema.safeParse(
    parseReplyOrUndefined(requestBody),
  );
  return searchRequestReply.success && searchRequestReply.data.query === match.query;
};

export const assertGlobalSearchSucceeded = (searchResponse: Response): void => {
  const isSearchResponseOk = searchResponse.ok();
  if (isSearchResponseOk) return;

  const status = searchResponse.status();
  throw new Error(`ChatGPT conversation search failed with HTTP ${status}.`);
};

const globalSearchResultsSchema = z.object({
  items: z.array(z.object({ source_type: z.string() })),
});

export const hasConversationMatches = (searchResponseBody: unknown): boolean => {
  const searchResultsReply = globalSearchResultsSchema.safeParse(searchResponseBody);

  const isThereNoValidReply = !searchResultsReply.success;
  if (isThereNoValidReply) {
    throw new Error("ChatGPT conversation search returned an unexpected answer.");
  }

  return searchResultsReply.data.items.some(
    (searchResult) => searchResult.source_type === "conversation",
  );
};

type SearchEntryQueryMatch = {
  readonly entry: ChatGptSearchEntry;
  readonly query: string;
};

export const isSearchEntryForQuery = (match: SearchEntryQueryMatch): boolean => {
  const entryUrl = new URL(match.entry.href, "https://chatgpt.com");
  return entryUrl.searchParams.get("historySearchQuery") === match.query;
};

const closeOpenSearch = async (page: Page): Promise<void> => {
  const closeButton = page.getByRole("button", { name: "Close global search", exact: true });
  const isCloseButtonHidden = !(await closeButton.isVisible());
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

const searchEntriesIn = async (dialog: Locator): Promise<ChatGptSearchEntry[]> => {
  return dialog.locator(CHATGPT_SEARCH.resultLink).evaluateAll(
    (links, titleSelector) =>
      links.flatMap((link) => {
        const href = link.getAttribute("href");

        const isHrefMissing = href === null;
        if (isHrefMissing) return [];

        const titleNode = link.querySelector(titleSelector);
        const isLinkElement = link instanceof HTMLElement;
        const fallbackTitle = isLinkElement ? link.innerText.split("\n")[0] : "";
        let rawTitle = fallbackTitle;

        const hasTitleNode = titleNode !== null && titleNode.textContent !== null;
        if (hasTitleNode) rawTitle = titleNode.textContent;

        if (rawTitle === undefined) rawTitle = "";

        const title = rawTitle.trim();
        return title ? [{ href, title }] : [];
      }),
    CHATGPT_SEARCH.resultTitle,
  );
};

const searchEntriesFor = async (dialog: Locator, query: string): Promise<ChatGptSearchEntry[]> => {
  const entries = await searchEntriesIn(dialog);
  return entries.filter((entry) => isSearchEntryForQuery({ entry, query }));
};

export const acknowledgeChatGptHistoryRateLimit = async (page: Page): Promise<boolean> => {
  const isClosedPage = page.isClosed();
  if (isClosedPage) return false;

  const modal = page.locator(CHATGPT_SEARCH.rateLimit).first();
  const isModalHidden = !(await modal.isVisible());
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
  const isRateLimitHidden = !(await page.locator(CHATGPT_SEARCH.rateLimit).isVisible());
  if (isRateLimitHidden) return;

  throw new Error(
    "ChatGPT conversation search is temporarily rate-limited. Wait a few minutes and try again.",
  );
};

export const waitForChatGptSearchResults = async (
  page: Page,
  dialog: Locator,
  query: string,
): Promise<void> => {
  for (let poll = 0; poll < SEARCH_RENDER_POLL_COUNT; poll += 1) {
    await assertSearchAvailable(page);
    const queryEntries = await searchEntriesFor(dialog, query);

    const hasQueryEntries = queryEntries.length > 0;
    if (hasQueryEntries) return;

    await page.waitForTimeout(SEARCH_RESULTS_POLL_MS);
  }
  throw new Error("ChatGPT found matching chats but did not show them in Search.");
};

const scrollSearchResults = async (dialog: Locator): Promise<boolean> => {
  const firstResult = dialog.locator(CHATGPT_SEARCH.resultLink).first();
  const hasNoFirstResult = (await firstResult.count()) === 0;
  if (hasNoFirstResult) return false;

  return firstResult.evaluate((resultLink) => {
    const searchDialog = resultLink.closest('[role="dialog"]');
    let scrollCandidate = resultLink.parentElement;
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

const resetSearchResultsScroll = async (dialog: Locator): Promise<void> => {
  const firstResult = dialog.locator(CHATGPT_SEARCH.resultLink).first();
  const hasNoFirstResult = (await firstResult.count()) === 0;
  if (hasNoFirstResult) return;

  await firstResult.evaluate((resultLink) => {
    const searchDialog = resultLink.closest('[role="dialog"]');
    let scrollCandidate = resultLink.parentElement;
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

const collectVisibleSearchResults = async (
  dialog: Locator,
  query: string,
  resultsById: Map<string, ConversationSearchResult>,
): Promise<void> => {
  const entries = await searchEntriesFor(dialog, query);
  for (const entry of entries) {
    const result = chatGptSearchResultFor(entry, resultsById.size);
    const isHitUnseen = result != null && !resultsById.has(result.id);
    if (isHitUnseen) {
      resultsById.set(result.id, result);
    }
  }
};

const collectSearchResults = async (
  page: Page,
  dialog: Locator,
  query: string,
  limit: number,
): Promise<ConversationSearchResult[]> => {
  const resultsById = new Map<string, ConversationSearchResult>();
  let unchangedScrolls = 0;
  while (resultsById.size < limit && unchangedScrolls < MAX_UNCHANGED_SCROLLS) {
    await collectVisibleSearchResults(dialog, query, resultsById);

    const isByIdSizeAtLeastLimit = resultsById.size >= limit;
    if (isByIdSizeAtLeastLimit) break;

    const resultCountBeforeScroll = resultsById.size;

    const isScrollFailed = !(await scrollSearchResults(dialog));
    if (isScrollFailed) break;

    for (
      let poll = 0;
      poll < SEARCH_RESULTS_POLL_COUNT && resultsById.size === resultCountBeforeScroll;
      poll += 1
    ) {
      await page.waitForTimeout(SEARCH_RESULTS_POLL_MS);
      await collectVisibleSearchResults(dialog, query, resultsById);
    }

    const isResultCountUnchanged = resultsById.size === resultCountBeforeScroll;
    if (isResultCountUnchanged) unchangedScrolls += 1;
    else unchangedScrolls = 0;
  }
  return Array.from(resultsById.values()).slice(0, limit);
};

export const searchChatGptConversations = async (
  page: Page,
  input: ConversationSearchInput,
): Promise<ConversationSearchResult[]> => {
  const query = input.query.trim();
  const isQueryEmpty = !query;
  if (isQueryEmpty) return [];

  const limit = input.limit === undefined ? 20 : input.limit;
  try {
    const dialog = await openChatSearch(page);
    await assertSearchAvailable(page);
    const field = dialog.locator(CHATGPT_SEARCH.input).first();
    await field.fill("");
    await field.focus();
    const searchResponsePromise = page.waitForResponse(
      (response) => isGlobalSearchResponseFor({ response, query }),
      { timeout: SEARCH_RESPONSE_TIMEOUT_MS },
    );
    await field.pressSequentially(query, { delay: 25 });
    const searchResponse = await searchResponsePromise;
    assertGlobalSearchSucceeded(searchResponse);

    const searchResponseBody: unknown = await searchResponse.json();
    const isNotConversationMatchesSearch = !hasConversationMatches(searchResponseBody);
    if (isNotConversationMatchesSearch) return [];

    await waitForChatGptSearchResults(page, dialog, query);
    await resetSearchResultsScroll(dialog);
    return await collectSearchResults(page, dialog, query, limit);
  } finally {
    await closeOpenSearch(page);
  }
};
