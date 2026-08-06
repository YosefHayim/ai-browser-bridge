import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import { PROVIDER_CONFIG } from "@/config";
import { selectorDrivenProvider } from "./selectorDrivenProvider.ts";

const fakePage = (
  counts: Readonly<Record<string, number>>,
  textBySelector: Readonly<Record<string, string>> = {},
): Page => {
  const locator = (selector: string) => {
    const selectedCount = counts[selector];
    const selectedText = textBySelector[selector];
    const locatorStub = {
      count: async () => {
        if (selectedCount === undefined) return 0;
        return selectedCount;
      },
      first: () => locatorStub,
      last: () => locatorStub,
      nth: () => locatorStub,
      getAttribute: async () => null as string | null,
      innerText: async () => {
        if (selectedText === undefined) return "";
        return selectedText;
      },
      allInnerTexts: async () => {
        if (selectedText === undefined) return [];
        return [selectedText];
      },
    };
    return locatorStub;
  };
  return { locator } as unknown as Page;
};

describe("selectorDrivenProvider", () => {
  const claudeProvider = selectorDrivenProvider("claude");
  const deepseekProvider = selectorDrivenProvider("deepseek");
  const duckProvider = selectorDrivenProvider("duck");
  const claudeConfig = PROVIDER_CONFIG.claude;
  const composerSelector = claudeConfig.selectors.composer;
  const assistantSelector = claudeConfig.selectors.assistant;
  const userSelector = claudeConfig.selectors.user;
  const signedOutSelector = claudeConfig.selectors.signedOut;
  const sidebarItemSelector = claudeConfig.selectors.sidebarItem;

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
      claudeProvider.assertSignedIn(fakePage({ [composerSelector]: 0 })),
    ).rejects.toThrow(/composer/);
    await expect(
      claudeProvider.assertSignedIn(fakePage({ [composerSelector]: 1 })),
    ).resolves.toBeUndefined();

    if (signedOutSelector === undefined) {
      throw new Error("expected Claude signedOut selector in PROVIDER_CONFIG");
    }
    await expect(
      claudeProvider.assertSignedIn(fakePage({ [composerSelector]: 1, [signedOutSelector]: 1 })),
    ).rejects.toThrow(/not signed in/);
  });

  it("captures the latest assistant text and counts assistant nodes", async () => {
    const page = fakePage({ [assistantSelector]: 2 }, { [assistantSelector]: "  hi there  " });
    expect(await claudeProvider.captureLastResponse(page)).toBe("hi there");
    expect(await claudeProvider.countAssistantResponses(page)).toBe(2);
  });

  it("captures user and assistant messages when user selector is configured", async () => {
    if (userSelector === undefined) {
      throw new Error("expected Claude user selector in PROVIDER_CONFIG");
    }
    const page = fakePage(
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
    if (sidebarItemSelector === undefined) {
      throw new Error("expected Claude sidebarItem selector in PROVIDER_CONFIG");
    }
    const page = fakePage({ [sidebarItemSelector]: 0 });
    expect(await claudeProvider.readSidebarConversations(page)).toEqual([]);
  });

  it("reports rewind as unsupported", async () => {
    await expect(claudeProvider.rewindLastUserPrompt(fakePage({}))).rejects.toThrow(
      /not supported/,
    );
  });

  it("returns a no-op connector result when MCP setup is not wired", async () => {
    const connectorResult = await deepseekProvider.setupMcpConnector?.(
      fakePage({}),
      "https://example.com/mcp",
    );
    expect(connectorResult).toEqual({
      connectorUrl: "https://example.com/mcp",
      completed: false,
      steps: [],
      warnings: ["DeepSeek has no MCP connector setup wired."],
    });
  });
});
