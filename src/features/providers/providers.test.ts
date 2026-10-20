import { describe, expect, it } from "vitest";
import { DEFAULT_PROVIDER, PROVIDER_CONFIG, PROVIDER_IDS } from "@/config";
import { UnknownProviderError } from "./providerErrors.ts";
import {
  conversationIdForProviderUrl,
  providerFor,
  providerIdForUrl,
  providerIdFrom,
  providerIdsFrom,
} from "./providers.ts";

describe("Provider registration", () => {
  it("accepts every canonical provider id", () => {
    for (const providerId of PROVIDER_IDS) {
      expect(providerIdFrom(providerId)).toBe(providerId);
      expect(providerFor(providerId).id).toBe(providerId);
    }
  });

  it("uses the default provider only when input is absent or blank", () => {
    expect(providerIdFrom(undefined)).toBe(DEFAULT_PROVIDER);
    expect(providerIdFrom("")).toBe(DEFAULT_PROVIDER);
    expect(providerIdFrom("   ")).toBe(DEFAULT_PROVIDER);
  });

  it("rejects aliases, case changes, and unknown provider ids", () => {
    for (const providerId of ["gpt", "Gemini", "claude.ai", "bogus"]) {
      expect(() => providerIdFrom(providerId)).toThrow(UnknownProviderError);
    }
  });

  it("registers every configured provider exactly once", () => {
    const registeredProviderIds = PROVIDER_IDS.map((providerId) => providerFor(providerId).id);
    expect(registeredProviderIds).toEqual(PROVIDER_IDS);
    expect(new Set(registeredProviderIds).size).toBe(PROVIDER_IDS.length);
    for (const providerId of PROVIDER_IDS) {
      expect(providerFor(providerId).origin).toBe(PROVIDER_CONFIG[providerId].origin);
    }
  });

  it("exposes provider capabilities", () => {
    expect(providerFor("chatgpt").supportsMcpConnector).toBe(true);
    expect(providerFor("gemini").supportsMcpConnector).toBe(false);
    expect(providerFor("claude").supportsMcpConnector).toBe(true);
    expect(providerFor("grok").supportsMcpConnector).toBe(true);
    expect(typeof providerFor("grok").setupMcpConnector).toBe("function");
  });
});

describe("Provider fan-out input", () => {
  it("parses canonical comma-separated ids and removes duplicates", () => {
    expect(providerIdsFrom("chatgpt,gemini,chatgpt")).toEqual(["chatgpt", "gemini"]);
  });

  it("uses the default provider when input is absent or blank", () => {
    expect(providerIdsFrom(undefined)).toEqual([DEFAULT_PROVIDER]);
    expect(providerIdsFrom("  ")).toEqual([DEFAULT_PROVIDER]);
  });

  it("rejects a list containing an unknown provider", () => {
    expect(() => providerIdsFrom("chatgpt,bogus")).toThrow(UnknownProviderError);
  });
});

describe("Provider tab ownership", () => {
  it("gives each tab URL to its most specific Provider", () => {
    expect(providerIdForUrl("https://claude.ai/new")).toBe("claude");
    expect(providerIdForUrl("https://claude.ai/chat/abc")).toBe("claude");
    expect(providerIdForUrl("https://claude.ai/design")).toBe("design");
    expect(providerIdForUrl("https://claude.ai/design/p/abc?file=x.html")).toBe("design");
    expect(providerIdForUrl("https://claude.ai/designer")).toBe("claude");
    expect(providerIdForUrl("https://www.perplexity.ai/search/x")).toBe("perplexity");
    expect(providerIdForUrl("https://labs.google/fx/tools/flow")).toBe("flow");
  });

  it("owns no tab outside the configured hosts", () => {
    expect(providerIdForUrl("about:blank")).toBeUndefined();
    expect(providerIdForUrl("https://example.com/?next=https://claude.ai/design")).toBeUndefined();
    expect(providerIdForUrl("not a url")).toBeUndefined();
  });
});

describe("Provider conversation ids", () => {
  it("reads the chat id from a ChatGPT chat URL", () => {
    const url = "https://chatgpt.com/c/6ad3a201-95b8-83ed-a175-a8007d1a732a";
    expect(conversationIdForProviderUrl({ providerId: "chatgpt", url })).toBe(
      "6ad3a201-95b8-83ed-a175-a8007d1a732a",
    );
  });

  it("has no chat id on the ChatGPT home page", () => {
    const url = "https://chatgpt.com/";
    expect(conversationIdForProviderUrl({ providerId: "chatgpt", url })).toBeNull();
  });

  it("has no chat id for a /c/ path on a non-ChatGPT host", () => {
    const url = "https://example.com/c/6ad3a201-95b8-83ed-a175-a8007d1a732a";
    expect(conversationIdForProviderUrl({ providerId: "chatgpt", url })).toBeNull();
  });

  it("has no chat id for other providers", () => {
    const url = "https://claude.ai/chat/6ad3a201-95b8-83ed-a175-a8007d1a732a";
    expect(conversationIdForProviderUrl({ providerId: "claude", url })).toBeNull();
  });
});
