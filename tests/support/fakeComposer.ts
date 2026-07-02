import type { Page } from "playwright";

/**
 * Counters and knobs a fake Page exposes so each test can assert how many times the
 * composer was filled/sent and on which attempt the simulated submit "took".
 */
export interface FakeComposer {
  page: Page;
  /** Times `input.fill()` ran — one per send attempt in injectPrompt. */
  fillCount: number;
  /** Times the explicit send button was clicked. */
  sendClickCount: number;
}

/**
 * Build a Page stub implementing exactly the surface injectPrompt touches.
 *
 * `clearsOnAttempt` models the no-op send bug: the composer reports non-empty text
 * until that many fills have happened, after which `evaluate` returns "" to mimic
 * the provider draining the composer on a real submit. `sendButtonToken` is the
 * selector substring identifying the provider's send button (ChatGPT: "send-button";
 * Gemini: "Send message"). `waitForTimeout` resolves immediately to keep polling fast.
 */
export function makeFakeComposer(
  clearsOnAttempt: number,
  options: { promptText?: string; sendButtonToken?: string } = {},
): FakeComposer {
  const promptText = options.promptText ?? "hello";
  const sendButtonToken = options.sendButtonToken ?? "send-button";
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
    evaluate: async <Result>(): Promise<Result> => {
      const cleared = state.fillCount >= clearsOnAttempt;
      return (cleared ? "" : promptText) as Result;
    },
    locator: (selector: string) =>
      (selector.includes(sendButtonToken) ? sendButton : locator).first(),
  } as unknown as Page;

  return state;
}
