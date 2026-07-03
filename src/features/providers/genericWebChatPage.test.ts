import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import { GenericWebChatPage } from "./genericWebChatPage.ts";
import { PROVIDERS } from "./providerRegistry.ts";

/** Minimal fake Page: locator(sel) → { count, innerText } driven by the maps below. */
function fakePage(counts: Record<string, number>, text: Record<string, string> = {}): Page {
  const locator = (sel: string) => {
    const self = {
      count: async () => counts[sel] ?? 0,
      first: () => self,
      last: () => self,
      innerText: async () => text[sel] ?? "",
      allInnerTexts: async () => (text[sel] ? [text[sel]] : []),
    };
    return self;
  };
  return { locator } as unknown as Page;
}

const profile = {
  id: "demo",
  origin: "demo.test",
  defaultUrl: "https://demo.test/",
  defaultModel: "Demo",
  displayName: "Demo",
  supportsMcpConnector: false,
  selectors: { composer: "#composer", assistant: ".assistant" },
};

describe("GenericWebChatPage", () => {
  it("maps the profile onto the BrowserProvider fields", () => {
    const page = new GenericWebChatPage(profile);
    expect(page.id).toBe("demo");
    expect(page.origin).toBe("demo.test");
    expect(page.composerSelector).toBe("#composer");
    expect(page.supportsMcpConnector).toBe(false);
  });

  it("recognizes model labels heuristically", () => {
    const page = new GenericWebChatPage(profile);
    expect(page.isLikelyModelLabel("Claude 3.5 Sonnet")).toBe(true);
    expect(page.isLikelyModelLabel("")).toBe(false);
    expect(page.isLikelyModelLabel("a very ordinary sentence with no model name at all here")).toBe(
      false,
    );
  });

  it("assertSignedIn throws when the composer is absent, resolves when present", async () => {
    const page = new GenericWebChatPage(profile);
    await expect(page.assertSignedIn(fakePage({ "#composer": 0 }))).rejects.toThrow(/composer/);
    await expect(page.assertSignedIn(fakePage({ "#composer": 1 }))).resolves.toBeUndefined();
  });

  it("captureLastResponse returns the trimmed last assistant text", async () => {
    const page = new GenericWebChatPage(profile);
    expect(await page.captureLastResponse(fakePage({}, { ".assistant": "  hi there  " }))).toBe(
      "hi there",
    );
  });
});

describe("registered provider configs", () => {
  it("exposes the four new providers with correct ids and origins", () => {
    expect(PROVIDERS.claude.origin).toBe("claude.ai");
    expect(PROVIDERS.deepseek.origin).toBe("chat.deepseek.com");
    expect(PROVIDERS.grok.origin).toBe("grok.com");
    expect(PROVIDERS.perplexity.origin).toBe("perplexity.ai");
    expect(PROVIDERS.claude.displayName).toBe("Claude");
  });
});
