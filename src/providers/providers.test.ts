import { describe, expect, it } from "vitest";
import { DEFAULT_PROVIDER, PROVIDER_IDS, PROVIDER_SETTINGS } from "@/config";
import {
  listProviderIdsFrom,
  readConversationIdForProviderUrl,
  readProvider,
  readProviderIdForUrl,
  readProviderIdFrom,
} from "./providers.ts";

describe("Provider registration", () => {
  it("accepts every canonical provider id", () => {
    for (const providerId of PROVIDER_IDS) {
      expect(readProviderIdFrom(providerId)).toBe(providerId);
      expect(readProvider(providerId).id).toBe(providerId);
    }
  });

  it("uses the default provider only when input is absent or blank", () => {
    expect(readProviderIdFrom(undefined)).toBe(DEFAULT_PROVIDER);
    expect(readProviderIdFrom("")).toBe(DEFAULT_PROVIDER);
    expect(readProviderIdFrom("   ")).toBe(DEFAULT_PROVIDER);
  });

  it("rejects aliases, case changes, and unknown provider ids", () => {
    for (const providerId of ["gpt", "Gemini", "claude.ai", "bogus"]) {
      expect(() => readProviderIdFrom(providerId)).toThrow("Unknown provider");
    }
  });

  it("registers every configured provider exactly once", () => {
    const registeredProviderIds = PROVIDER_IDS.map((providerId) => readProvider(providerId).id);
    expect(registeredProviderIds).toEqual(PROVIDER_IDS);
    expect(new Set(registeredProviderIds).size).toBe(PROVIDER_IDS.length);
    for (const providerId of PROVIDER_IDS) {
      expect(readProvider(providerId).origin).toBe(PROVIDER_SETTINGS[providerId].origin);
    }
  });

  it("exposes provider capabilities", () => {
    expect(readProvider("chatgpt").supportsMcpConnector).toBe(true);
    expect(readProvider("gemini").supportsMcpConnector).toBe(false);
    expect(readProvider("claude").supportsMcpConnector).toBe(true);
    expect(readProvider("grok").supportsMcpConnector).toBe(true);
    expect(typeof readProvider("grok").setupMcpConnector).toBe("function");
  });
});

describe("Provider fan-out input", () => {
  it("parses canonical comma-separated ids and removes duplicates", () => {
    expect(listProviderIdsFrom("chatgpt,gemini,chatgpt")).toEqual(["chatgpt", "gemini"]);
  });

  it("uses the default provider when input is absent or blank", () => {
    expect(listProviderIdsFrom(undefined)).toEqual([DEFAULT_PROVIDER]);
    expect(listProviderIdsFrom("  ")).toEqual([DEFAULT_PROVIDER]);
  });

  it("rejects a list containing an unknown provider", () => {
    expect(() => listProviderIdsFrom("chatgpt,bogus")).toThrow("Unknown provider");
  });
});

describe("Provider tab ownership", () => {
  it("gives each tab URL to its most specific Provider", () => {
    expect(readProviderIdForUrl("https://claude.ai/new")).toBe("claude");
    expect(readProviderIdForUrl("https://claude.ai/chat/abc")).toBe("claude");
    expect(readProviderIdForUrl("https://claude.ai/design")).toBe("design");
    expect(readProviderIdForUrl("https://claude.ai/design/p/abc?file=x.html")).toBe("design");
    expect(readProviderIdForUrl("https://claude.ai/designer")).toBe("claude");
    expect(readProviderIdForUrl("https://www.perplexity.ai/search/x")).toBe("perplexity");
    expect(readProviderIdForUrl("https://labs.google/fx/tools/flow")).toBe("flow");
  });

  it("owns no tab outside the configured hosts", () => {
    expect(readProviderIdForUrl("about:blank")).toBeUndefined();
    expect(
      readProviderIdForUrl("https://example.com/?next=https://claude.ai/design"),
    ).toBeUndefined();
    expect(readProviderIdForUrl("not a url")).toBeUndefined();
  });
});

describe("Provider conversation ids", () => {
  it("reads the chat id from a ChatGPT chat URL", () => {
    const url = "https://chatgpt.com/c/6ad3a201-95b8-83ed-a175-a8007d1a732a";
    expect(readConversationIdForProviderUrl({ providerId: "chatgpt", url })).toBe(
      "6ad3a201-95b8-83ed-a175-a8007d1a732a",
    );
  });

  it("has no chat id on the ChatGPT home page", () => {
    const url = "https://chatgpt.com/";
    expect(readConversationIdForProviderUrl({ providerId: "chatgpt", url })).toBeNull();
  });

  it("has no chat id for a /c/ path on a non-ChatGPT host", () => {
    const url = "https://example.com/c/6ad3a201-95b8-83ed-a175-a8007d1a732a";
    expect(readConversationIdForProviderUrl({ providerId: "chatgpt", url })).toBeNull();
  });

  it("has no chat id for other providers", () => {
    const url = "https://claude.ai/chat/6ad3a201-95b8-83ed-a175-a8007d1a732a";
    expect(readConversationIdForProviderUrl({ providerId: "claude", url })).toBeNull();
  });
});
