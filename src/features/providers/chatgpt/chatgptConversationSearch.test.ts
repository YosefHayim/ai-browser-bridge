import { errors, type Locator, type Page, type Response } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { fakeControlsPage } from "@/testSupport/fakeControlsPage.ts";
import {
  acknowledgeChatGptHistoryRateLimit,
  assertGlobalSearchSucceeded,
  CHATGPT_SEARCH,
  chatGptSearchResultFor,
  hasConversationMatches,
  isGlobalSearchResponseFor,
  isSearchEntryForQuery,
  searchChatGptConversations,
  waitForChatGptSearchResults,
} from "./chatgptConversationSearch.ts";

describe("ChatGPT conversation search", () => {
  it("targets the current global Search controls", () => {
    expect(CHATGPT_SEARCH.trigger).toBe('button[aria-label="Search"]');
    expect(CHATGPT_SEARCH.dialog).toBe(
      '[role="dialog"]:has(button[aria-label="Close global search"])',
    );
    expect(CHATGPT_SEARCH.input).toBe('input[role="combobox"]');
    expect(CHATGPT_SEARCH.resultLink).toBe('a[href*="/c/"]');
    expect(CHATGPT_SEARCH.rateLimit).toBe("#modal-conversation-history-rate-limit");
    expect(CHATGPT_SEARCH.searchEndpoint).toBe("/backend-api/global/search");
  });

  it("waits only for the global search response of the typed query", () => {
    const searchResponse = (url: string, requestBody: string) =>
      ({ url: () => url, request: () => ({ postData: () => requestBody }) }) as unknown as Response;
    const avatarBody = JSON.stringify({ entrypoint: "global_search", query: "avatar" });
    const staleBody = JSON.stringify({ entrypoint: "global_search", query: "yoga" });

    expect(
      isGlobalSearchResponseFor({
        response: searchResponse("https://chatgpt.com/backend-api/global/search", avatarBody),
        query: "avatar",
      }),
    ).toBe(true);
    expect(
      isGlobalSearchResponseFor({
        response: searchResponse("https://chatgpt.com/backend-api/global/search", staleBody),
        query: "avatar",
      }),
    ).toBe(false);
    expect(
      isGlobalSearchResponseFor({
        response: searchResponse("https://chatgpt.com/backend-api/wham/usage", avatarBody),
        query: "avatar",
      }),
    ).toBe(false);
  });

  it("rejects a failed global search answer", () => {
    const failedResponse = { ok: () => false, status: () => 500 } as unknown as Response;
    const okResponse = { ok: () => true, status: () => 200 } as unknown as Response;

    expect(() => assertGlobalSearchSucceeded(failedResponse)).toThrow(
      "ChatGPT conversation search failed with HTTP 500.",
    );
    expect(() => assertGlobalSearchSucceeded(okResponse)).not.toThrow();
  });

  it("reads whether the global search answer holds any chats", () => {
    const chatMatch = { source_type: "conversation" };
    const imageMatch = { source_type: "library" };

    expect(hasConversationMatches({ items: [imageMatch, chatMatch] })).toBe(true);
    expect(hasConversationMatches({ items: [imageMatch] })).toBe(false);
    expect(() => hasConversationMatches({ results: [] })).toThrow(
      "ChatGPT conversation search returned an unexpected answer.",
    );
  });

  it("keeps only result links ChatGPT made for the typed query", () => {
    const avatarHref = "/c/conversation-1?src=history_search&historySearchQuery=avatar";
    const staleHref = "/c/conversation-2?src=history_search&historySearchQuery=yoga";
    const recentHref = "/c/conversation-3";
    const spacedHref = "/c/conversation-4?historySearchQuery=yoga+app";

    expect(
      isSearchEntryForQuery({ entry: { href: avatarHref, title: "A" }, query: "avatar" }),
    ).toBe(true);
    expect(isSearchEntryForQuery({ entry: { href: staleHref, title: "B" }, query: "avatar" })).toBe(
      false,
    );
    expect(
      isSearchEntryForQuery({ entry: { href: recentHref, title: "C" }, query: "avatar" }),
    ).toBe(false);
    expect(
      isSearchEntryForQuery({ entry: { href: spacedHref, title: "D" }, query: "yoga app" }),
    ).toBe(true);
  });

  it("opens Search from the visible trigger when a hidden rail copy comes first", async () => {
    const { page, clicks } = fakeControlsPage([
      { name: "rail search", selector: CHATGPT_SEARCH.trigger, visible: false },
      { name: "sidebar search", selector: CHATGPT_SEARCH.trigger, visible: true },
    ]);

    await expect(searchChatGptConversations(page, { query: "avatar" })).rejects.toThrow(
      errors.TimeoutError,
    );
    expect(clicks).toEqual(["sidebar search"]);
  });

  it("keeps ChatGPT result order and preserves project Conversation links", () => {
    const result = chatGptSearchResultFor(
      {
        href: "/g/g-p-project/c/conversation-123?src=history_search&messageId=message-456",
        title: "  Yoga routine notes  ",
      },
      4,
    );

    expect(result).toEqual({
      id: "conversation-123",
      title: "Yoga routine notes",
      url: "https://chatgpt.com/g/g-p-project/c/conversation-123?src=history_search&messageId=message-456",
      provider: "chatgpt",
      source: "providerSearch",
      score: 96,
    });
  });

  it("rejects non-Conversation and untitled search entries", () => {
    expect(chatGptSearchResultFor({ href: "/library", title: "Yoga image" }, 0)).toBeUndefined();
    expect(chatGptSearchResultFor({ href: "/c/conversation-123", title: " " }, 0)).toBeUndefined();
  });

  it("waits until Search shows results for the typed query", async () => {
    const shownEntries = [
      [{ href: "/c/stale?historySearchQuery=yoga", title: "Stale result" }],
      [{ href: "/c/fresh?historySearchQuery=avatar", title: "Avatar result" }],
    ];
    const evaluateAll = vi.fn(async () => shownEntries.shift());
    const dialog = { locator: () => ({ evaluateAll }) } as unknown as Locator;
    const page = {
      locator: () => ({ isVisible: async () => false }),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    } as unknown as Page;

    await expect(waitForChatGptSearchResults(page, dialog, "avatar")).resolves.toBeUndefined();
    expect(evaluateAll).toHaveBeenCalledTimes(2);
  });

  it("does not accept stale results as the typed query's results", async () => {
    const dialog = {
      locator: () => ({
        evaluateAll: async () => [{ href: "/c/stale?historySearchQuery=yoga", title: "Stale" }],
      }),
    } as unknown as Locator;
    const page = {
      locator: () => ({ isVisible: async () => false }),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    } as unknown as Page;

    await expect(waitForChatGptSearchResults(page, dialog, "avatar")).rejects.toThrow(
      "ChatGPT found matching chats but did not show them in Search.",
    );
  });

  it("acknowledges ChatGPT's history rate-limit modal", async () => {
    const evaluate = vi.fn().mockResolvedValue(undefined);
    const waitFor = vi.fn().mockResolvedValue(undefined);
    const acknowledge = { isVisible: async () => true, evaluate };
    const modal = {
      isVisible: async () => true,
      getByRole: () => ({ first: () => acknowledge }),
      waitFor,
    };
    const page = {
      isClosed: () => false,
      locator: () => ({ first: () => modal }),
    } as unknown as Page;

    await expect(acknowledgeChatGptHistoryRateLimit(page)).resolves.toBe(true);
    expect(evaluate).toHaveBeenCalledOnce();
    expect(waitFor).toHaveBeenCalledWith({ state: "hidden", timeout: 3_000 });
  });

  it("does not inspect a closed ChatGPT tab", async () => {
    const locator = vi.fn();
    const page = {
      isClosed: () => true,
      locator,
    } as unknown as Page;

    await expect(acknowledgeChatGptHistoryRateLimit(page)).resolves.toBe(false);
    expect(locator).not.toHaveBeenCalled();
  });
});
