import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import { injectPrompt } from "../../src/browser/chatgpt-page.ts";

/**
 * Counters and knobs a fake Page exposes so each test can assert how many times
 * the composer was filled/sent and on which attempt the simulated submit "took".
 *
 * `clearsOnAttempt` models the no-op send bug: the composer reports non-empty
 * text until at least that many fills have happened, after which `evaluate`
 * returns "" to mimic ChatGPT draining `#prompt-textarea` on a real submit. Set
 * it past the retry budget to simulate a send that never lands.
 */
interface FakeComposer {
  page: Page;
  /** Times `input.fill()` ran — one per send attempt in injectPrompt. */
  fillCount: number;
  /** Times the explicit send button was clicked. */
  sendClickCount: number;
}

/**
 * Build a Page stub implementing exactly the surface injectPrompt touches.
 *
 * `evaluate` ignores the passed browser function and instead returns scenario
 * text driven by `fillCount`, letting us simulate "cleared after N sends"
 * without a real browser. `waitForTimeout` resolves immediately to keep the
 * poll loop fast.
 */
function makeFakeComposer(clearsOnAttempt: number, promptText = "hello"): FakeComposer {
  const state: FakeComposer = {
    fillCount: 0,
    sendClickCount: 0,
    page: undefined as unknown as Page,
  };

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
      (selector.includes("send-button") ? sendButton : locator).first(),
  } as unknown as Page;

  return state;
}

describe("injectPrompt submission confirmation", () => {
  it("resolves after a single send when the composer clears on attempt 1", async () => {
    const composer = makeFakeComposer(1);

    await expect(injectPrompt(composer.page, "hello")).resolves.toBeUndefined();
    expect(composer.fillCount).toBe(1);
    expect(composer.sendClickCount).toBe(1);
  });

  it("re-fills and re-sends when attempt 1 stays full and attempt 2 clears", async () => {
    const composer = makeFakeComposer(2);

    await expect(injectPrompt(composer.page, "hello")).resolves.toBeUndefined();
    expect(composer.fillCount).toBe(2);
    expect(composer.sendClickCount).toBe(2);
  });

  it("throws after 3 attempts when the composer never clears", async () => {
    const composer = makeFakeComposer(Number.POSITIVE_INFINITY);

    await expect(injectPrompt(composer.page, "hello")).rejects.toThrow(
      "composer never cleared after 3 send attempts",
    );
    expect(composer.fillCount).toBe(3);
  });
});
