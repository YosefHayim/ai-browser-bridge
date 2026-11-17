import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import { PROVIDER_SETTINGS } from "@/provider-settings.ts";
import { SelectorDrivenProvider } from "@/providers/engine/selector-driven-provider.ts";
import {
  claudeProfile,
  deepseekProfile,
  duckProfile,
} from "@/providers/engine/selector-profiles.ts";

function createFakePage(
  counts: Readonly<Record<string, number>>,
  labelBySelector: Readonly<Record<string, string>> = {},
): Page {
  function createFakeLocator(selector: string) {
    const selectedCount = counts[selector];
    const selectedLabel = labelBySelector[selector];
    const locatorStub = {
      count: async () => {
        const isSelectedCountMissing = selectedCount == null;
        if (isSelectedCountMissing) return 0;

        return selectedCount;
      },
      first: () => locatorStub,
      last: () => locatorStub,
      nth: () => locatorStub,
      getAttribute: async () => null,
      innerText: async () => {
        const isSelectedMissing = selectedLabel == null;
        if (isSelectedMissing) return "";

        return selectedLabel;
      },
      allInnerTexts: async () => {
        const isSelectedMissing = selectedLabel == null;
        if (isSelectedMissing) return [];

        return [selectedLabel];
      },
    };
    return locatorStub;
  }
  return { locator: createFakeLocator } as unknown as Page;
}

describe("SelectorDrivenProvider", () => {
  const noPage = {} as Page;
  const claudeProvider = new SelectorDrivenProvider(claudeProfile, noPage);
  function createClaudeProvider(page: Page) {
    return new SelectorDrivenProvider(claudeProfile, page);
  }
  const claudeSettings = PROVIDER_SETTINGS.claude;
  const composerSelector = claudeSettings.selectors.composer;
  const assistantSelector = claudeSettings.selectors.assistant;
  const userSelector = claudeSettings.selectors.user;
  const signedOutSelector = claudeSettings.selectors.signedOut;
  const sidebarElementSelector = claudeSettings.selectors.sidebarItem;

  it("binds profile metadata from PROVIDER_SETTINGS", () => {
    expect(claudeProfile.id).toBe("claude");
    expect(claudeProfile.origin).toBe("claude.ai");
    expect(claudeProfile.composerSelector).toBe(composerSelector);
    expect(claudeProfile.supportsMcpConnector).toBe(true);
    expect(deepseekProfile.id).toBe("deepseek");
    expect(deepseekProfile.supportsMcpConnector).toBe(false);
    expect(duckProfile.id).toBe("duck");
    expect(duckProfile.origin).toBe("duck.ai");
  });

  it("recognizes short model labels and rejects empty or long ordinary text", () => {
    expect(claudeProvider.isLikelyModelLabel("Claude 3.5 Sonnet")).toBe(true);
    expect(claudeProvider.isLikelyModelLabel("DeepSeek Reasoner")).toBe(true);
    expect(claudeProvider.isLikelyModelLabel("")).toBe(false);
    expect(
      claudeProvider.isLikelyModelLabel("a very ordinary sentence with no model name at all here"),
    ).toBe(false);
  });

  it("requires a visible composer and rejects signed-out markers", async () => {
    await expect(
      createClaudeProvider(createFakePage({ [composerSelector]: 0 })).assertSignedIn(),
    ).rejects.toThrow(/composer/);
    await expect(
      createClaudeProvider(createFakePage({ [composerSelector]: 1 })).assertSignedIn(),
    ).resolves.toBeUndefined();

    const isSignedOutSelectorMissing = signedOutSelector == null;
    if (isSignedOutSelectorMissing) {
      throw new Error("expected Claude signedOut selector in PROVIDER_SETTINGS");
    }

    await expect(
      createClaudeProvider(
        createFakePage({ [composerSelector]: 1, [signedOutSelector]: 1 }),
      ).assertSignedIn(),
    ).rejects.toThrow(/not signed in/);
  });

  it("captures the latest assistant text and counts assistant nodes", async () => {
    const page = createFakePage(
      { [assistantSelector]: 2 },
      { [assistantSelector]: "  hi there  " },
    );
    expect(await createClaudeProvider(page).captureLastReply()).toBe("hi there");
    expect(await createClaudeProvider(page).countAssistantReplies()).toBe(2);
  });

  it("captures user and assistant messages when user selector is configured", async () => {
    const isUserSelectorMissing = userSelector == null;
    if (isUserSelectorMissing) {
      throw new Error("expected Claude user selector in PROVIDER_SETTINGS");
    }

    const page = createFakePage(
      {},
      {
        [assistantSelector]: "assistant reply",
        [userSelector]: "user prompt",
      },
    );
    const messages = await createClaudeProvider(page).captureAllMessages();
    expect(messages).toEqual([
      { role: "user", content: "user prompt" },
      { role: "assistant", content: "assistant reply" },
    ]);
  });

  it("returns an empty sidebar list when the page has no matching links", async () => {
    const isSidebarSelectorMissing = sidebarElementSelector == null;
    if (isSidebarSelectorMissing) {
      throw new Error("expected Claude sidebarItem selector in PROVIDER_SETTINGS");
    }

    const page = createFakePage({ [sidebarElementSelector]: 0 });
    expect(await createClaudeProvider(page).readSidebarConversations()).toEqual([]);
  });

  it("reports rewind as unsupported", async () => {
    await expect(createClaudeProvider(createFakePage({})).rewindLastUserPrompt()).rejects.toThrow(
      /not supported/,
    );
  });

  it("returns a no-op connector result when MCP setup is not wired", async () => {
    const deepseekProvider = new SelectorDrivenProvider(deepseekProfile, createFakePage({}));
    const connectorReport = await deepseekProvider.setupMcpConnector?.("https://example.com/mcp");
    expect(connectorReport).toEqual({
      connectorUrl: "https://example.com/mcp",
      completed: false,
      steps: [],
      warnings: ["DeepSeek has no MCP connector setup wired."],
    });
  });
});
