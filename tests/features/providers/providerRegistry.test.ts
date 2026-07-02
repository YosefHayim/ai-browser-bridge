import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROVIDER,
  PROVIDER_IDS,
  UnknownProviderError,
  getBrowserProvider,
  normalizeProvider,
} from "../../../src/features/providers/providerRegistry.ts";

describe("normalizeProvider", () => {
  it("resolves the canonical ids", () => {
    expect(normalizeProvider("chatgpt")).toBe("chatgpt");
    expect(normalizeProvider("gemini")).toBe("gemini");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(normalizeProvider("  GEMINI ")).toBe("gemini");
  });

  it("resolves known aliases", () => {
    expect(normalizeProvider("gpt")).toBe("chatgpt");
    expect(normalizeProvider("bard")).toBe("gemini");
  });

  it("falls back to the default provider when empty or absent", () => {
    expect(normalizeProvider(undefined)).toBe(DEFAULT_PROVIDER);
    expect(normalizeProvider("")).toBe(DEFAULT_PROVIDER);
    expect(normalizeProvider("   ")).toBe(DEFAULT_PROVIDER);
  });

  it("unwraps { value } and { id } input shapes", () => {
    expect(normalizeProvider({ value: "gemini" })).toBe("gemini");
    expect(normalizeProvider({ id: "chatgpt" })).toBe("chatgpt");
  });

  it("throws a listing error on an explicit unknown provider (never silently coerces)", () => {
    expect(() => normalizeProvider("claude")).toThrow(UnknownProviderError);
    expect(() => normalizeProvider("claude")).toThrow(/Valid providers: chatgpt, gemini/);
  });
});

describe("getBrowserProvider", () => {
  it("returns the adapter whose id matches the resolved provider", () => {
    expect(getBrowserProvider("gemini").id).toBe("gemini");
    expect(getBrowserProvider(undefined).id).toBe(DEFAULT_PROVIDER);
  });
});

describe("PROVIDER_IDS", () => {
  it("lists exactly the registered providers", () => {
    expect(PROVIDER_IDS).toEqual(["chatgpt", "gemini"]);
  });
});
