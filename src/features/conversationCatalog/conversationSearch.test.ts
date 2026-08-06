import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { rankConversations, searchConversations } from "./conversationSearch.ts";

describe("conversation catalog search", () => {
  it("ranks exact title matches before fuzzy token matches", () => {
    const rankedConversations = rankConversations({
      conversations: [
        { id: "a", title: "Bridge provider cleanup", url: "https://chatgpt.com/c/a" },
        { id: "b", title: "AI browser bridge", url: "https://chatgpt.com/c/b" },
        { id: "c", title: "Browser profile memory issue", url: "https://chatgpt.com/c/c" },
      ],
      provider: "chatgpt",
      query: "AI browser bridge",
      source: "sidebar",
      limit: 3,
    });

    expect(rankedConversations.map((conversation) => conversation.id)).toEqual(["b", "a", "c"]);
    expect(rankedConversations[0]?.source).toBe("sidebar");
    expect(rankedConversations[0]?.score).toBe(110);
  });

  it("matches ids and respects the result limit", () => {
    const rankedConversations = rankConversations({
      conversations: [
        { id: "abc-123", title: "Unrelated", url: "https://chatgpt.com/c/abc-123" },
        { id: "def-456", title: "abc notes", url: "https://chatgpt.com/c/def-456" },
      ],
      provider: "chatgpt",
      query: "abc",
      source: "providerSearch",
      limit: 1,
    });

    expect(rankedConversations).toHaveLength(1);
    expect(rankedConversations[0]?.id).toBe("abc-123");
    expect(rankedConversations[0]?.source).toBe("providerSearch");
    expect(rankedConversations[0]?.score).toBe(100);
  });

  it("returns the newest sidebar slice when the query is empty", () => {
    const rankedConversations = rankConversations({
      conversations: [
        { id: "a", title: "First", url: "https://chatgpt.com/c/a" },
        { id: "b", title: "Second", url: "https://chatgpt.com/c/b" },
      ],
      provider: "chatgpt",
      query: "",
      source: "sidebar",
      limit: 1,
    });

    expect(rankedConversations.map((conversation) => conversation.id)).toEqual(["a"]);
    expect(rankedConversations[0]?.score).toBe(0);
  });

  it("clamps invalid limits to the default and caps the upper bound", () => {
    const conversations = Array.from({ length: 30 }, (_, index) => ({
      id: `id-${index}`,
      title: `Conversation ${index}`,
      url: `https://chatgpt.com/c/${index}`,
    }));

    const defaultLimited = rankConversations({
      conversations,
      provider: "chatgpt",
      query: "",
      source: "sidebar",
      limit: 0,
    });
    expect(defaultLimited).toHaveLength(20);

    const capped = rankConversations({
      conversations: Array.from({ length: 120 }, (_, index) => ({
        id: `id-${index}`,
        title: `Conversation ${index}`,
        url: `https://chatgpt.com/c/${index}`,
      })),
      provider: "chatgpt",
      query: "",
      source: "sidebar",
      limit: 500,
    });
    expect(capped).toHaveLength(100);
  });

  it("prefers provider search results when the provider returns matches", async () => {
    const page = {} as Page;
    const providerResults = [
      {
        id: "provider-1",
        title: "From provider",
        url: "https://chatgpt.com/c/provider-1",
        provider: "chatgpt",
        source: "providerSearch" as const,
        score: 50,
      },
      {
        id: "provider-2",
        title: "Also provider",
        url: "https://chatgpt.com/c/provider-2",
        provider: "chatgpt",
        source: "providerSearch" as const,
        score: 40,
      },
    ];
    const searchProviderConversations = vi.fn(async () => providerResults);
    const readSidebarConversations = vi.fn(async () => [
      { id: "sidebar-1", title: "Sidebar only", url: "https://chatgpt.com/c/sidebar-1" },
    ]);

    const rankedConversations = await searchConversations({
      page,
      provider: {
        id: "chatgpt",
        readSidebarConversations,
        searchConversations: searchProviderConversations,
      },
      query: "bridge",
      limit: 1,
    });

    expect(searchProviderConversations).toHaveBeenCalledWith(page, { query: "bridge", limit: 1 });
    expect(readSidebarConversations).not.toHaveBeenCalled();
    expect(rankedConversations).toEqual([providerResults[0]]);
  });

  it("falls back to sidebar ranking when provider search is empty", async () => {
    const page = {} as Page;
    const searchProviderConversations = vi.fn(async () => []);
    const readSidebarConversations = vi.fn(async () => [
      { id: "side-a", title: "Bridge notes", url: "https://chatgpt.com/c/side-a" },
      { id: "side-b", title: "Unrelated", url: "https://chatgpt.com/c/side-b" },
    ]);

    const rankedConversations = await searchConversations({
      page,
      provider: {
        id: "chatgpt",
        readSidebarConversations,
        searchConversations: searchProviderConversations,
      },
      query: "bridge",
      limit: 5,
    });

    expect(searchProviderConversations).toHaveBeenCalled();
    expect(readSidebarConversations).toHaveBeenCalledWith(page);
    expect(rankedConversations.map((conversation) => conversation.id)).toEqual(["side-a"]);
    expect(rankedConversations[0]?.source).toBe("sidebar");
  });

  it("ranks sidebar conversations when the provider has no search capability", async () => {
    const page = {} as Page;
    const readSidebarConversations = vi.fn(async () => [
      { id: "side-1", title: "Exact bridge", url: "https://chatgpt.com/c/side-1" },
    ]);

    const rankedConversations = await searchConversations({
      page,
      provider: {
        id: "gemini",
        readSidebarConversations,
      },
      query: "exact bridge",
    });

    expect(readSidebarConversations).toHaveBeenCalledWith(page);
    expect(rankedConversations).toHaveLength(1);
    expect(rankedConversations[0]).toMatchObject({
      id: "side-1",
      provider: "gemini",
      source: "sidebar",
      score: 110,
    });
  });
});
