import { errors, type Locator, type Page, type Response } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { fakeControlsPage } from "@/testSupport/fakeControlsPage.ts";
import {
  acknowledgeChatGptHistoryRateLimit,
  CHATGPT_SEARCH,
  chatGptSearchResultFor,
  isGlobalSearchResponseFor,
  searchChatGptConversations,
  waitForChatGptSearchResultsUpdate,
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

  it("settles when ChatGPT answers with the results already shown", async () => {
    const dialog = {
      locator: () => ({
        evaluateAll: async () => [{ href: "/c/stale-conversation", title: "Stale result" }],
      }),
    } as unknown as Locator;
    const page = {
      locator: () => ({ isVisible: async () => false }),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    } as unknown as Page;

    await expect(
      waitForChatGptSearchResultsUpdate(
        page,
        dialog,
        JSON.stringify([{ href: "/c/stale-conversation", title: "Stale result" }]),
      ),
    ).resolves.toBeUndefined();
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
