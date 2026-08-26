import type { Locator, Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import {
  acknowledgeChatGptHistoryRateLimit,
  CHATGPT_SEARCH,
  chatGptSearchResultFor,
  waitForChatGptSearchResultsUpdate,
} from "./chatgptConversationSearch.ts";

describe("ChatGPT conversation search", () => {
  it("targets the current global Search controls", () => {
    expect(CHATGPT_SEARCH.trigger).toBe('button[aria-label="Search"]');
    expect(CHATGPT_SEARCH.input).toBe('input[name="global-search"]');
    expect(CHATGPT_SEARCH.resultLink).toBe('a[href*="/c/"]');
    expect(CHATGPT_SEARCH.rateLimit).toBe("#modal-conversation-history-rate-limit");
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

  it("fails when ChatGPT never refreshes stale results", async () => {
    const resultLink = {
      getAttribute: async () => "/c/stale-conversation",
      locator: () => ({ first: () => ({ innerText: async () => "Stale result" }) }),
    };
    const dialog = {
      locator: () => ({ all: async () => [resultLink] }),
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
    ).rejects.toThrow("did not refresh its results");
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
