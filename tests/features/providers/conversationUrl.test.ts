import { describe, expect, it } from "vitest";
import {
  conversationIdFromUrl,
  conversationUrlFromIdOrUrl,
  isSameChatGptConversation,
} from "../../../src/features/providers/conversationUrl.ts";

describe("conversation-url", () => {
  it("extracts ids from ChatGPT conversation URLs", () => {
    expect(conversationIdFromUrl("https://chatgpt.com/c/abc-123")).toBe("abc-123");
    expect(conversationIdFromUrl("https://chatgpt.com/c/abc-123?model=gpt-4o")).toBe("abc-123");
    expect(conversationIdFromUrl("https://chatgpt.com/")).toBeNull();
  });

  it("builds canonical conversation URLs from ids", () => {
    expect(conversationUrlFromIdOrUrl("abc-123")).toBe("https://chatgpt.com/c/abc-123");
    expect(conversationUrlFromIdOrUrl("https://chatgpt.com/c/abc-123")).toBe(
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
