import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import { injectPrompt, isLikelyModelLabel, isTurnSettled, SELECTORS } from "../../../../src/features/providers/gemini/gemini-page.class.ts";

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
  function makeFakeComposer(clearsOnAttempt: number, promptText = "hello") {
    const state = { fillCount: 0, sendClickCount: 0, page: undefined as unknown as Page };

    const locator = {
      click: async (): Promise<void> => {},
      fill: async (): Promise<void> => {
        state.fillCount += 1;
      },
      dispatchEvent: async (): Promise<void> => {},
      waitFor: async (): Promise<void> => {},
      first(): typeof locator {
        return this;
      },
    };

    const sendButton = {
      ...locator,
      click: async (): Promise<void> => {
        state.sendClickCount += 1;
      },
    };

    state.page = {
      bringToFront: async (): Promise<void> => {},
      keyboard: { press: async (): Promise<void> => {} },
      waitForTimeout: async (): Promise<void> => {},
      evaluate: async <Result,>(): Promise<Result> => {
        const cleared = state.fillCount >= clearsOnAttempt;
        return (cleared ? "" : promptText) as Result;
      },
      locator: (selector: string) =>
        (selector.includes("Send message") ? sendButton : locator).first(),
    } as unknown as Page;

    return state;
  }

  it("resolves after the composer clears", async () => {
    const composer = makeFakeComposer(1);
    await expect(injectPrompt(composer.page, "hello")).resolves.toBeUndefined();
    expect(composer.fillCount).toBe(1);
  });

  it("throws after 3 attempts when the composer never clears", async () => {
    const composer = makeFakeComposer(Number.POSITIVE_INFINITY);
    await expect(injectPrompt(composer.page, "hello")).rejects.toThrow(
      "composer never cleared after 3 send attempts",
    );
    expect(composer.fillCount).toBe(3);
  });
});
