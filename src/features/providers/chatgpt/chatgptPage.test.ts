import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { fakeControlsPage } from "@/testSupport/fakeControlsPage.ts";
import { GuestSessionError } from "../providerErrors.ts";
import {
  chatGptProvider,
  noModelMatchedMessage,
  parseChatGptSidebarConversationLink,
  SELECTORS,
} from "./chatgptPage.ts";

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

describe("ChatGPT prompt attachments", () => {
  it("sends every file to the multi-file input instead of the single-file camera input", async () => {
    const queriedSelectors: string[] = [];
    const setInputFiles = vi.fn().mockResolvedValue(undefined);
    const page = {
      locator: (selector: string) => {
        queriedSelectors.push(selector);
        return { first: () => ({ count: async () => 1, setInputFiles }) };
      },
    } as unknown as Page;
    const imagePaths = ["me.png", "style-wave.png", "style-peace.png"];

    await chatGptProvider.attachFilesToPrompt(page, imagePaths);

    expect(queriedSelectors).toEqual(['input[type="file"][multiple]:not([accept])']);
    expect(setInputFiles).toHaveBeenCalledWith(imagePaths);
  });

  it("falls back to the Add photos & files menu item when the input is missing", async () => {
    const clicks: string[] = [];
    const setFiles = vi.fn().mockResolvedValue(undefined);
    const control = (name: string, matches: number) => {
      const locator = {
        filter: () => locator,
        first: () => locator,
        count: async () => matches,
        isVisible: async () => matches > 0,
        click: async () => {
          clicks.push(name);
        },
      };
      return locator;
    };
    const page = {
      locator: (selector: string) => {
        if (selector === SELECTORS.attachmentInput) return control("file input", 0);
        return control(selector, 1);
      },
      getByRole: (_role: string, options: { name: string }) => control(options.name, 1),
      waitForEvent: async () => ({ setFiles }),
    } as unknown as Page;
    const imagePaths = ["me.png", "style-wave.png", "style-peace.png"];

    await chatGptProvider.attachFilesToPrompt(page, imagePaths);

    expect(clicks).toEqual(['button[aria-label="Add files and more"]', "Add photos & files"]);
    expect(setFiles).toHaveBeenCalledWith(imagePaths);
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

describe("noModelMatchedMessage", () => {
  it("lists the model names the menu showed", () => {
    expect(noModelMatchedMessage({ query: "o9", seenLabels: ["GPT-5", "GPT-4o"] })).toBe(
      'No model matched "o9". The model menu showed: GPT-5, GPT-4o.',
    );
  });

  it("says so when the menu showed no names", () => {
    expect(noModelMatchedMessage({ query: "o9", seenLabels: [] })).toBe(
      'No model matched "o9". The model menu opened but showed no model names.',
    );
  });
});
