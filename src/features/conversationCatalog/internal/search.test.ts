import { describe, expect, it } from "vitest";
import { rankConversations } from "./search.ts";

describe("conversation catalog search", () => {
  it("ranks exact title matches before fuzzy token matches", () => {
    const results = rankConversations({
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

    expect(results.map((result) => result.id)).toEqual(["b", "a", "c"]);
    expect(results[0]?.source).toBe("sidebar");
  });

  it("matches ids and respects the result limit", () => {
    const results = rankConversations({
      conversations: [
        { id: "abc-123", title: "Unrelated", url: "https://chatgpt.com/c/abc-123" },
        { id: "def-456", title: "abc notes", url: "https://chatgpt.com/c/def-456" },
      ],
      provider: "chatgpt",
      query: "abc",
      source: "providerSearch",
      limit: 1,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("abc-123");
    expect(results[0]?.source).toBe("providerSearch");
  });

  it("returns the newest sidebar slice when the query is empty", () => {
    const results = rankConversations({
      conversations: [
        { id: "a", title: "First", url: "https://chatgpt.com/c/a" },
        { id: "b", title: "Second", url: "https://chatgpt.com/c/b" },
      ],
      provider: "chatgpt",
      query: "",
      source: "sidebar",
      limit: 1,
    });

    expect(results.map((result) => result.id)).toEqual(["a"]);
    expect(results[0]?.score).toBe(0);
  });
});
