import { Option, Schema } from "effect";
import type { Locator, Page, Response } from "playwright";
import type {
  ConversationSearchInput,
  ConversationSearchResult,
} from "@/features/conversationCatalog";
import { chatGptConversationIdFromUrl } from "./chatgptConversationUrl.ts";

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
  if (conversationId === null || !title) return undefined;
  return {
    id: conversationId,
    title,
    url: new URL(entry.href, "https://chatgpt.com").toString(),
    provider: "chatgpt",
    source: "providerSearch",
    score: Math.max(1, 100 - index),
  };
};

const decodeGlobalSearchRequest = Schema.decodeUnknownOption(
  Schema.parseJson(Schema.Struct({ query: Schema.String })),
);

type GlobalSearchResponseMatch = {
  readonly response: Response;
  readonly query: string;
};

export const isGlobalSearchResponseFor = (match: GlobalSearchResponseMatch): boolean => {
  const responseUrl = new URL(match.response.url());
  if (responseUrl.pathname !== CHATGPT_SEARCH.searchEndpoint) return false;
  const requestBody = match.response.request().postData();
  const searchRequest = decodeGlobalSearchRequest(requestBody);
  return Option.isSome(searchRequest) && searchRequest.value.query === match.query;
};

export const assertGlobalSearchSucceeded = (searchResponse: Response): void => {
  if (searchResponse.ok()) return;
  const status = searchResponse.status();
  throw new Error(`ChatGPT conversation search failed with HTTP ${status}.`);
};

const decodeGlobalSearchResults = Schema.decodeUnknownOption(
  Schema.Struct({ items: Schema.Array(Schema.Struct({ source_type: Schema.String })) }),
);

export const hasConversationMatches = (searchResponseBody: unknown): boolean => {
  const searchResults = decodeGlobalSearchResults(searchResponseBody);
  if (Option.isNone(searchResults)) {
    throw new Error("ChatGPT conversation search returned an unexpected answer.");
  }
  return searchResults.value.items.some((item) => item.source_type === "conversation");
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
  if (!(await closeButton.isVisible())) return;
  await closeButton.evaluate((button) => {
    if (button instanceof HTMLElement) button.click();
  });
};

const openChatSearch = async (page: Page): Promise<Locator> => {
  await closeOpenSearch(page);
  const trigger = page.locator(CHATGPT_SEARCH.trigger).filter({ visible: true }).first();
  await trigger.waitFor({ state: "visible", timeout: 8_000 });
  await trigger.evaluate((button) => {
    if (button instanceof HTMLElement) button.click();
  });
  const dialog = page.locator(CHATGPT_SEARCH.dialog).first();
  await dialog.waitFor({ state: "visible", timeout: 8_000 });
  const chatsTab = dialog.getByRole("tab", { name: "Chats", exact: true });
  if (await chatsTab.isVisible()) await chatsTab.click();
  return dialog;
};

const searchEntriesIn = async (dialog: Locator): Promise<ChatGptSearchEntry[]> => {
  return dialog.locator(CHATGPT_SEARCH.resultLink).evaluateAll(
    (links, titleSelector) =>
      links.flatMap((link) => {
        const href = link.getAttribute("href");
        if (href === null) return [];
        const titleNode = link.querySelector(titleSelector);
        const fallbackTitle = link instanceof HTMLElement ? link.innerText.split("\n")[0] : "";
        let rawTitle = fallbackTitle;
        if (titleNode !== null && titleNode.textContent !== null) rawTitle = titleNode.textContent;
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
  if (page.isClosed()) return false;
  const modal = page.locator(CHATGPT_SEARCH.rateLimit).first();
  if (!(await modal.isVisible())) return false;
  const acknowledge = modal.getByRole("button", { name: "Got it", exact: true }).first();
  if (await acknowledge.isVisible()) {
    await acknowledge.evaluate((button) => {
      if (button instanceof HTMLElement) button.click();
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
  if (!(await page.locator(CHATGPT_SEARCH.rateLimit).isVisible())) return;
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
    if (queryEntries.length > 0) return;
    await page.waitForTimeout(SEARCH_RESULTS_POLL_MS);
  }
  throw new Error("ChatGPT found matching chats but did not show them in Search.");
};

const scrollSearchResults = async (dialog: Locator): Promise<boolean> => {
  const firstResult = dialog.locator(CHATGPT_SEARCH.resultLink).first();
  if ((await firstResult.count()) === 0) return false;
  return firstResult.evaluate((resultLink) => {
    const searchDialog = resultLink.closest('[role="dialog"]');
    let scrollCandidate = resultLink.parentElement;
    while (scrollCandidate && searchDialog?.contains(scrollCandidate)) {
      if (scrollCandidate.scrollHeight > scrollCandidate.clientHeight + 20) {
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
  if ((await firstResult.count()) === 0) return;
  await firstResult.evaluate((resultLink) => {
    const searchDialog = resultLink.closest('[role="dialog"]');
    let scrollCandidate = resultLink.parentElement;
    while (scrollCandidate && searchDialog?.contains(scrollCandidate)) {
      if (scrollCandidate.scrollHeight > scrollCandidate.clientHeight + 20) {
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
    if (result !== undefined && !resultsById.has(result.id)) {
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
    if (resultsById.size >= limit) break;
    const resultCountBeforeScroll = resultsById.size;
    if (!(await scrollSearchResults(dialog))) break;
    for (
      let poll = 0;
      poll < SEARCH_RESULTS_POLL_COUNT && resultsById.size === resultCountBeforeScroll;
      poll += 1
    ) {
      await page.waitForTimeout(SEARCH_RESULTS_POLL_MS);
      await collectVisibleSearchResults(dialog, query, resultsById);
    }
    if (resultsById.size === resultCountBeforeScroll) unchangedScrolls += 1;
    else unchangedScrolls = 0;
  }
  return Array.from(resultsById.values()).slice(0, limit);
};

export const searchChatGptConversations = async (
  page: Page,
  input: ConversationSearchInput,
): Promise<ConversationSearchResult[]> => {
  const query = input.query.trim();
  if (!query) return [];
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
    if (!hasConversationMatches(searchResponseBody)) return [];
    await waitForChatGptSearchResults(page, dialog, query);
    await resetSearchResultsScroll(dialog);
    return await collectSearchResults(page, dialog, query, limit);
  } finally {
    await closeOpenSearch(page);
  }
};
