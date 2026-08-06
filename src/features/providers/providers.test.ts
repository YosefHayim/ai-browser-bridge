import { describe, expect, it } from "vitest";
import { DEFAULT_PROVIDER, PROVIDER_CONFIG, PROVIDER_IDS } from "@/config";
import { UnknownProviderError } from "./providerErrors.ts";
import { providerFor, providerIdFrom, providerIdsFrom } from "./providers.ts";

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
