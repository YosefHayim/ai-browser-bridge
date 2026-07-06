import { describe, expect, it } from "vitest";
import {
  chatGptConversationIdFromUrl,
  chatGptConversationUrlFromIdOrUrl,
  isSameChatGptConversation,
} from "./chatgptConversationUrl.ts";

describe("chatGptConversationUrl", () => {
  it("extracts ids from ChatGPT conversation URLs", () => {
    expect(chatGptConversationIdFromUrl("https://chatgpt.com/c/abc-123")).toBe("abc-123");
    expect(chatGptConversationIdFromUrl("https://chatgpt.com/c/abc-123?model=gpt-4o")).toBe(
      "abc-123",
    );
    expect(chatGptConversationIdFromUrl("https://chatgpt.com/")).toBeNull();
  });

  it("builds canonical conversation URLs from ids", () => {
    expect(chatGptConversationUrlFromIdOrUrl("abc-123")).toBe("https://chatgpt.com/c/abc-123");
    expect(chatGptConversationUrlFromIdOrUrl("https://chatgpt.com/c/abc-123")).toBe(
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
