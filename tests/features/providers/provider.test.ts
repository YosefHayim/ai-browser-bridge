import { describe, expect, it } from "vitest";
import {
  getBrowserProvider,
  normalizeProvider,
} from "../../../src/features/providers/providerRegistry.ts";

describe("browser provider registry", () => {
  it("defaults unknown values to chatgpt", () => {
    expect(normalizeProvider(undefined)).toBe("chatgpt");
    expect(normalizeProvider("chatgpt")).toBe("chatgpt");
  });

  it("normalizes gemini provider strings", () => {
    expect(normalizeProvider("gemini")).toBe("gemini");
    expect(normalizeProvider("Gemini")).toBe("gemini");
  });

  it("returns provider-specific capabilities", () => {
    const chatgpt = getBrowserProvider("chatgpt");
    const gemini = getBrowserProvider("gemini");

    expect(chatgpt.supportsMcpConnector).toBe(true);
    expect(chatgpt.origin).toBe("chatgpt.com");
    expect(gemini.supportsMcpConnector).toBe(false);
    expect(gemini.origin).toBe("gemini.google.com");
    expect(gemini.defaultUrl).toContain("gemini.google.com");
  });
});
