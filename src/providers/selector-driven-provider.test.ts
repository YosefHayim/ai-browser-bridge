import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import { PROVIDER_SETTINGS } from "@/config";
import { createSelectorDrivenProvider } from "./selector-driven-provider.ts";

const createFakePage = (
  counts: Readonly<Record<string, number>>,
  labelBySelector: Readonly<Record<string, string>> = {},
): Page => {
  const createFakeLocator = (selector: string) => {
    const selectedCount = counts[selector];
    const selectedLabel = labelBySelector[selector];
    const locatorStub = {
      count: async () => {
        const isSelectedCountMissing = selectedCount === undefined;
        if (isSelectedCountMissing) return 0;

        return selectedCount;
      },
      first: () => locatorStub,
      last: () => locatorStub,
      nth: () => locatorStub,
      getAttribute: async () => null as string | null,
      innerText: async () => {
        const isSelectedMissing = selectedLabel === undefined;
        if (isSelectedMissing) return "";

        return selectedLabel;
      },
      allInnerTexts: async () => {
        const isSelectedMissing = selectedLabel === undefined;
        if (isSelectedMissing) return [];

        return [selectedLabel];
      },
    };
    return locatorStub;
  };
  return { locator: createFakeLocator } as unknown as Page;
};

describe("createSelectorDrivenProvider", () => {
  const claudeProvider = createSelectorDrivenProvider("claude");
  const deepseekProvider = createSelectorDrivenProvider("deepseek");
  const duckProvider = createSelectorDrivenProvider("duck");
  const claudeSettings = PROVIDER_CONFIG.claude;
  const composerSelector = claudeSettings.selectors.composer;
  const assistantSelector = claudeSettings.selectors.assistant;
  const userSelector = claudeSettings.selectors.user;
  const signedOutSelector = claudeSettings.selectors.signedOut;
  const sidebarElementSelector = claudeSettings.selectors.sidebarItem;

  it("binds profile metadata from PROVIDER_CONFIG", () => {
    expect(claudeProvider.id).toBe("claude");
    expect(claudeProvider.origin).toBe("claude.ai");
    expect(claudeProvider.composerSelector).toBe(composerSelector);
    expect(claudeProvider.supportsMcpConnector).toBe(true);
    expect(deepseekProvider.id).toBe("deepseek");
    expect(deepseekProvider.supportsMcpConnector).toBe(false);
    expect(duckProvider.id).toBe("duck");
    expect(duckProvider.origin).toBe("duck.ai");
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
      claudeProvider.assertSignedIn(createFakePage({ [composerSelector]: 0 })),
    ).rejects.toThrow(/composer/);
    await expect(
      claudeProvider.assertSignedIn(createFakePage({ [composerSelector]: 1 })),
    ).resolves.toBeUndefined();

    const isSignedOutSelectorMissing = signedOutSelector === undefined;
    if (isSignedOutSelectorMissing) {
      throw new Error("expected Claude signedOut selector in PROVIDER_CONFIG");
    }

    await expect(
      claudeProvider.assertSignedIn(
        createFakePage({ [composerSelector]: 1, [signedOutSelector]: 1 }),
      ),
    ).rejects.toThrow(/not signed in/);
  });

  it("captures the latest assistant text and counts assistant nodes", async () => {
    const page = createFakePage(
      { [assistantSelector]: 2 },
      { [assistantSelector]: "  hi there  " },
    );
    expect(await claudeProvider.captureLastReply(page)).toBe("hi there");
    expect(await claudeProvider.countAssistantReplies(page)).toBe(2);
  });

  it("captures user and assistant messages when user selector is configured", async () => {
    const isUserSelectorMissing = userSelector === undefined;
    if (isUserSelectorMissing) {
      throw new Error("expected Claude user selector in PROVIDER_CONFIG");
    }

    const page = createFakePage(
      {},
      {
        [assistantSelector]: "assistant reply",
        [userSelector]: "user prompt",
      },
    );
    const messages = await claudeProvider.captureAllMessages(page);
    expect(messages).toEqual([
      { role: "user", content: "user prompt" },
      { role: "assistant", content: "assistant reply" },
    ]);
  });

  it("returns an empty sidebar list when the page has no matching links", async () => {
    const isSidebarSelectorMissing = sidebarElementSelector === undefined;
    if (isSidebarSelectorMissing) {
      throw new Error("expected Claude sidebarItem selector in PROVIDER_CONFIG");
    }

    const page = createFakePage({ [sidebarElementSelector]: 0 });
    expect(await claudeProvider.readSidebarConversations(page)).toEqual([]);
  });

  it("reports rewind as unsupported", async () => {
    await expect(claudeProvider.rewindLastUserPrompt(createFakePage({}))).rejects.toThrow(
      /not supported/,
    );
  });

  it("returns a no-op connector result when MCP setup is not wired", async () => {
    const connectorReport = await deepseekProvider.setupMcpConnector?.(
      createFakePage({}),
      "https://example.com/mcp",
    );
    expect(connectorReport).toEqual({
      connectorUrl: "https://example.com/mcp",
      completed: false,
      steps: [],
      warnings: ["DeepSeek has no MCP connector setup wired."],
    });
  });
});
