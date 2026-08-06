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

describe("selector-driven Provider", () => {
  const claudeProvider = selectorDrivenProvider("claude");
  const composerSelector = PROVIDER_CONFIG.claude.selectors.composer;
  const assistantSelector = PROVIDER_CONFIG.claude.selectors.assistant;

  it("uses the owning Provider configuration", () => {
    expect(claudeProvider.id).toBe("claude");
    expect(claudeProvider.origin).toBe("claude.ai");
    expect(claudeProvider.composerSelector).toBe(composerSelector);
    expect(claudeProvider.supportsMcpConnector).toBe(true);
  });

  it("recognizes model labels heuristically", () => {
    expect(claudeProvider.isLikelyModelLabel("Claude 3.5 Sonnet")).toBe(true);
    expect(claudeProvider.isLikelyModelLabel("")).toBe(false);
    expect(
      claudeProvider.isLikelyModelLabel("a very ordinary sentence with no model name at all here"),
    ).toBe(false);
  });

  it("requires the configured composer", async () => {
    await expect(
      claudeProvider.assertSignedIn(fakePage({ [composerSelector]: 0 })),
    ).rejects.toThrow(/composer/);
    await expect(
      claudeProvider.assertSignedIn(fakePage({ [composerSelector]: 1 })),
    ).resolves.toBeUndefined();
  });

  it("captures the latest configured assistant text", async () => {
    const page = fakePage({}, { [assistantSelector]: "  hi there  " });
    expect(await claudeProvider.captureLastResponse(page)).toBe("hi there");
  });
});
