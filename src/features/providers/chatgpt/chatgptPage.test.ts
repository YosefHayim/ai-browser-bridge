import { describe, expect, it } from "vitest";
import { parseChatGptSidebarConversationLink, SELECTORS } from "./chatgptPage.ts";

describe("ChatGPT page selectors", () => {
  it("includes current account menu selectors used by ChatGPT settings", () => {
    expect(SELECTORS.accountMenuButton).toContain('[data-testid="accounts-profile-button"]');
    expect(SELECTORS.accountMenuButton).toContain(
      '[role="button"][aria-label*="open profile menu" i]',
    );
  });

  it("matches ChatGPT-generated images by estuary content path and generated-image alt", () => {
    expect(SELECTORS.generatedImage).toContain("/backend-api/estuary/content");
    expect(SELECTORS.generatedImage).toContain('img[alt^="Generated image" i]');
  });
});

describe("ChatGPT sidebar conversations", () => {
  it("removes URL search parameters from conversation ids", () => {
    expect(
      parseChatGptSidebarConversationLink({
        href: "/c/conversation-123?messageId=finalAgentTurnStart",
        title: "Tracked conversation",
        ariaLabel: null,
      }),
    ).toEqual({
      id: "conversation-123",
      title: "Tracked conversation",
      url: "https://chatgpt.com/c/conversation-123?messageId=finalAgentTurnStart",
    });
  });

  it("filters pinned chats outside the loose Chats section when only orphans are requested", () => {
    const projectChat = {
      href: "/c/conversation-123",
      title: "Cal AI App Names",
      ariaLabel: "Cal AI App Names, pinned conversation",
    };

    expect(parseChatGptSidebarConversationLink(projectChat)).not.toBeNull();
    expect(parseChatGptSidebarConversationLink(projectChat, { orphans: true })).toBeNull();
  });
});
