import { describe, expect, it } from "vitest";
import {
  SELECTORS,
  injectPrompt,
  isLikelyModelLabel,
  isTurnSettled,
} from "../../../../src/features/providers/gemini/geminiPage.ts";
import { makeFakeComposer } from "../../../support/fakeComposer.ts";

describe("gemini-page selectors", () => {
  it("defines stable composer and response selectors", () => {
    expect(SELECTORS.promptInput).toContain("div.ql-editor");
    expect(SELECTORS.sendButton).toContain('button[aria-label="Send message"]');
    expect(SELECTORS.responseBlock).toContain("model-response");
  });
});

describe("gemini isLikelyModelLabel", () => {
  it("matches Gemini model names", () => {
    expect(isLikelyModelLabel("Gemini 2.5 Flash")).toBe(true);
    expect(isLikelyModelLabel("Pro")).toBe(true);
    expect(isLikelyModelLabel("ChatGPT")).toBe(false);
  });
});

describe("gemini isTurnSettled", () => {
  it("settles once text is stable and streaming stopped", () => {
    expect(
      isTurnSettled({
        hasText: true,
        isTransientText: false,
        streaming: false,
        stableForMs: 1_600,
      }),
    ).toBe(true);
  });

  it("does not settle while streaming", () => {
    expect(
      isTurnSettled({
        hasText: true,
        isTransientText: false,
        streaming: true,
        stableForMs: 5_000,
      }),
    ).toBe(false);
  });
});

describe("gemini injectPrompt submission confirmation", () => {
  it("resolves after the composer clears", async () => {
    const composer = makeFakeComposer(1, { sendButtonToken: "Send message" });
    await expect(injectPrompt(composer.page, "hello")).resolves.toBeUndefined();
    expect(composer.fillCount).toBe(1);
  });

  it("throws after 3 attempts when the composer never clears", async () => {
    const composer = makeFakeComposer(Number.POSITIVE_INFINITY, {
      sendButtonToken: "Send message",
    });
    await expect(injectPrompt(composer.page, "hello")).rejects.toThrow(
      "composer never cleared after 3 send attempts",
    );
    expect(composer.fillCount).toBe(3);
  });
});
