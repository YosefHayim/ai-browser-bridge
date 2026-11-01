import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { fakeControlsPage } from "@/testSupport/fakeControlsPage.ts";
import { GuestSessionError } from "../providerErrors.ts";
import { chatGptProvider, parseChatGptSidebarConversationLink, SELECTORS } from "./chatgptPage.ts";

const PROFILE_MENU = '[role="button"][aria-label*="open profile menu" i]';

describe("ChatGPT page selectors", () => {
  it("scopes prompt injection to known main-composer anchors", () => {
    expect(SELECTORS.promptInput.split(",").map((selector) => selector.trim())).toEqual([
      'div.ProseMirror[contenteditable="true"][aria-label="Ask ChatGPT"]',
      '[data-testid="prompt-textarea"]',
      "#prompt-textarea",
      'form[data-chatgpt-composer] [data-composer-markdown][contenteditable="true"][role="textbox"]',
      'form[data-chatgpt-composer] .ProseMirror[contenteditable="true"]',
    ]);
  });

  it("includes current account menu selectors used by ChatGPT settings", () => {
    expect(SELECTORS.accountMenuButton).toContain('button[aria-label="Open profile menu"]');
    expect(SELECTORS.accountMenuButton).toContain('[data-testid="accounts-profile-button"]');
    expect(SELECTORS.accountMenuButton).toContain(
      '[role="button"][aria-label*="open profile menu" i]',
    );
  });

  it("matches the current Send button label", () => {
    expect(SELECTORS.sendButton).toContain('button[aria-label="Send"]');
  });

  it("matches ChatGPT-generated images by estuary content path and generated-image alt", () => {
    expect(SELECTORS.generatedImage).toContain("/backend-api/estuary/content");
    expect(SELECTORS.generatedImage).toContain('img[alt^="Generated image" i]');
  });
});

describe("SELECTORS.generatedImageStrip", () => {
  it("matches the thumbnail strip images of a multi-image reply", () => {
    expect(SELECTORS.generatedImageStrip).toBe('[role="group"][aria-label="Generated images"] img');
  });
});

describe("ChatGPT prompt attachments", () => {
  const imagePaths = ["me.png", "style-wave.png", "style-peace.png"];
  const CHIP_SELECTOR = SELECTORS.attachedFileRemoveButton;

  it("sends every file to the multi-file input instead of the single-file camera input", async () => {
    const queriedSelectors: string[] = [];
    let chipCount = 0;
    const setInputFiles = vi.fn(async (paths: string[]) => {
      chipCount += paths.length;
    });
    const page = {
      locator: (selector: string) => {
        queriedSelectors.push(selector);
        return {
          count: async () => (selector === CHIP_SELECTOR ? chipCount : 1),
          first: () => ({ count: async () => 1, setInputFiles }),
        };
      },
      waitForTimeout: async () => {},
    } as unknown as Page;

    await chatGptProvider.attachFilesToPrompt(page, imagePaths);

    expect(queriedSelectors).toContain('input[type="file"][multiple]:not([accept])');
    expect(setInputFiles).toHaveBeenCalledWith(imagePaths);
  });

  it("fails when the composer never shows the attached file", async () => {
    const setInputFiles = vi.fn().mockResolvedValue(undefined);
    const page = {
      locator: (selector: string) => ({
        count: async () => (selector === CHIP_SELECTOR ? 0 : 1),
        first: () => ({ count: async () => 1, setInputFiles }),
      }),
      waitForTimeout: async () => {},
    } as unknown as Page;

    await expect(chatGptProvider.attachFilesToPrompt(page, imagePaths)).rejects.toThrow(
      "did not show the attached file",
    );
  });

  it("falls back to the Add photos & files menu item when the input is missing", async () => {
    const clicks: string[] = [];
    let chipCount = 0;
    const setFiles = vi.fn(async (paths: string[]) => {
      chipCount += paths.length;
    });
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
        if (selector === CHIP_SELECTOR) return { count: async () => chipCount };
        return control(selector, 1);
      },
      getByRole: (_role: string, options: { name: string }) => control(options.name, 1),
      waitForEvent: async () => ({ setFiles }),
      waitForTimeout: async () => {},
    } as unknown as Page;

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
