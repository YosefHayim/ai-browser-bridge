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

const SEARCH_CLEAR_SETTLE_MS = 300;
const SEARCH_RESPONSE_TIMEOUT_MS = 15_000;
const SEARCH_RESULTS_POLL_MS = 250;
const SEARCH_RESULTS_POLL_COUNT = 12;
const SEARCH_RENDER_POLL_COUNT = 8;
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

const searchEntriesSignature = async (dialog: Locator): Promise<string> => {
  return JSON.stringify(await searchEntriesIn(dialog));
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

export const waitForChatGptSearchResultsUpdate = async (
  page: Page,
  dialog: Locator,
  initialSignature: string,
): Promise<void> => {
  for (let poll = 0; poll < SEARCH_RENDER_POLL_COUNT; poll += 1) {
    await assertSearchAvailable(page);
    await page.waitForTimeout(SEARCH_RESULTS_POLL_MS);
    if ((await searchEntriesSignature(dialog)) !== initialSignature) return;
  }
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
  resultsById: Map<string, ConversationSearchResult>,
): Promise<void> => {
  const entries = await searchEntriesIn(dialog);
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
  limit: number,
): Promise<ConversationSearchResult[]> => {
  const resultsById = new Map<string, ConversationSearchResult>();
  let unchangedScrolls = 0;
  while (resultsById.size < limit && unchangedScrolls < MAX_UNCHANGED_SCROLLS) {
    await collectVisibleSearchResults(dialog, resultsById);
    if (resultsById.size >= limit) break;
    const resultCountBeforeScroll = resultsById.size;
    if (!(await scrollSearchResults(dialog))) break;
    for (
      let poll = 0;
      poll < SEARCH_RESULTS_POLL_COUNT && resultsById.size === resultCountBeforeScroll;
      poll += 1
    ) {
      await page.waitForTimeout(SEARCH_RESULTS_POLL_MS);
      await collectVisibleSearchResults(dialog, resultsById);
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
    await page.waitForTimeout(SEARCH_CLEAR_SETTLE_MS);
    const initialSignature = await searchEntriesSignature(dialog);
    await field.focus();
    const searchResponse = page.waitForResponse(
      (response) => isGlobalSearchResponseFor({ response, query }),
      { timeout: SEARCH_RESPONSE_TIMEOUT_MS },
    );
    await field.pressSequentially(query, { delay: 25 });
    await searchResponse;
    await waitForChatGptSearchResultsUpdate(page, dialog, initialSignature);
    await resetSearchResultsScroll(dialog);
    return await collectSearchResults(page, dialog, limit);
  } finally {
    await closeOpenSearch(page);
  }
};
