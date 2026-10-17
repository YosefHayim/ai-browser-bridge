import { describe, expect, it } from "vitest";
import { fakeControlsPage } from "@/testSupport/fakeControlsPage.ts";
import { GuestSessionError } from "../providerErrors.ts";
import { chatGptProvider, parseChatGptSidebarConversationLink, SELECTORS } from "./chatgptPage.ts";

const PROFILE_MENU = '[role="button"][aria-label*="open profile menu" i]';

describe("ChatGPT page selectors", () => {
  it("scopes prompt injection to known main-composer anchors", () => {
    expect(SELECTORS.promptInput.split(",").map((selector) => selector.trim())).toEqual([
      '[data-testid="prompt-textarea"]',
      "#prompt-textarea",
      'form[data-chatgpt-composer] [data-composer-markdown][contenteditable="true"][role="textbox"]',
      'form[data-chatgpt-composer] .ProseMirror[contenteditable="true"]',
    ]);
  });

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

describe("ChatGPT sign-in check", () => {
  it("finds the visible profile menu when a hidden rail copy comes first", async () => {
    const { page } = fakeControlsPage([
      { name: "rail profile menu", selector: PROFILE_MENU, visible: false },
      { name: "sidebar profile menu", selector: PROFILE_MENU, visible: true },
    ]);

    await expect(chatGptProvider.assertSignedIn(page)).resolves.toBeUndefined();
  });

  it("reports a guest session when only the login button is visible", async () => {
    const { page } = fakeControlsPage([
      { name: "rail profile menu", selector: PROFILE_MENU, visible: false },
      { name: "login button", selector: '[data-testid="login-button"]', visible: true },
    ]);

    await expect(chatGptProvider.assertSignedIn(page)).rejects.toThrow(GuestSessionError);
  });

  it("reports a guest session when no session control ever appears", async () => {
    const { page } = fakeControlsPage([]);

    await expect(chatGptProvider.assertSignedIn(page)).rejects.toThrow(GuestSessionError);
  });
});
