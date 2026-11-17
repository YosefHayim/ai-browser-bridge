import { describe, expect, it } from "vitest";
import {
  isSameChatGptConversation,
  readChatGptConversationIdFromUrl,
  readChatGptConversationUrlFromIdOrUrl,
  stripConversationId,
} from "@/providers/chatgpt/backend-api/chatgpt-conversation-url.ts";

describe("chatGptConversationUrl", () => {
  it("extracts ids from ChatGPT conversation URLs", () => {
    expect(readChatGptConversationIdFromUrl("https://chatgpt.com/c/abc-123")).toBe("abc-123");
    expect(readChatGptConversationIdFromUrl("https://chatgpt.com/c/abc-123?model=gpt-4o")).toBe(
      "abc-123",
    );
    expect(readChatGptConversationIdFromUrl("https://chatgpt.com/")).toBeNull();
  });

  it("builds canonical conversation URLs from ids", () => {
    expect(readChatGptConversationUrlFromIdOrUrl("abc-123")).toBe("https://chatgpt.com/c/abc-123");
    expect(readChatGptConversationUrlFromIdOrUrl("https://chatgpt.com/c/abc-123")).toBe(
      "https://chatgpt.com/c/abc-123",
    );
  });

  it("detects when the page is already on the target conversation", () => {
    const url = "https://chatgpt.com/c/abc-123";
    expect(isSameChatGptConversation(url, "abc-123")).toBe(true);
    expect(isSameChatGptConversation(url, url)).toBe(true);
    expect(isSameChatGptConversation(url, "other-id")).toBe(false);
  });
});

describe("stripConversationId", () => {
  it("extracts the id from a /c/<id> path", () => {
    expect(stripConversationId("/c/6a4231ee-02cc-83eb")).toBe("6a4231ee-02cc-83eb");
  });

  it("extracts the id from a full ChatGPT URL with query", () => {
    expect(stripConversationId("https://chatgpt.com/c/abc-123?model=gpt")).toBe("abc-123");
  });

  it("returns a bare id unchanged", () => {
    expect(stripConversationId("abc-123")).toBe("abc-123");
  });

  it("returns a non-id title unchanged so callers can match by title", () => {
    expect(stripConversationId("Cloudflare vs AWS")).toBe("Cloudflare vs AWS");
  });
});
