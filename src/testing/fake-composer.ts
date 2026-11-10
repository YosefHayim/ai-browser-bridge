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

/** The subset of a Playwright Locator that the fake composer implements. */
interface FakeLocator {
  click: () => Promise<void>;
  fill: () => Promise<void>;
  dispatchEvent: () => Promise<void>;
  waitFor: () => Promise<void>;
  /** The streaming guard polls this; the fake models an idle conversation (never streaming). */
  isVisible: () => Promise<boolean>;
  first: () => FakeLocator;
  filter: () => FakeLocator;
  /** The chat-mode guard counts inactive Chat toggles; the fake page has none. */
  count: () => Promise<number>;
}

/**
 * Build a Page stub implementing exactly the surface injectPrompt touches.
 *
 * `clearsOnAttempt` models the no-op send bug: the composer reports non-empty text
 * until that many fills have happened, after which `evaluate` returns "" to mimic
 * the provider draining the composer on a real submit. `sendButtonToken` is the
 * selector substring identifying the provider's send button (ChatGPT: "send-button";
 * Gemini: "Send message"). `waitForTimeout` resolves immediately to keep polling fast.
 *
 * @param clearsOnAttempt - Clears on attempt value.
 * @param settings - Options that configure the operation.
 * @returns The `makeFakeComposer` result.
 * @example
 * ```ts
 * const result = makeFakeComposer(clearsOnAttempt, options);
 * ```
 */
export const makeFakeComposer = (
  clearsOnAttempt: number,
  settings: { promptText?: string; sendButtonToken?: string } = {},
): FakeComposer => {
  const promptString = settings.promptText ?? "hello";
  const sendButtonToken = settings.sendButtonToken ?? "send-button";
  const status: FakeComposer = {
    fillCount: 0,
    sendClickCount: 0,
    page: undefined as unknown as Page,
  };

  const locator: FakeLocator = {
    click: async (): Promise<void> => {},
    fill: async (): Promise<void> => {
      status.fillCount += 1;
    },
    dispatchEvent: async (): Promise<void> => {},
    waitFor: async (): Promise<void> => {},
    isVisible: async (): Promise<boolean> => false,
    first(): FakeLocator {
      return this;
    },
    filter(): FakeLocator {
      return this;
    },
    count: async (): Promise<number> => 0,
  };

  const sendButton = {
    ...locator,
    click: async (): Promise<void> => {
      status.sendClickCount += 1;
    },
  };

  status.page = {
    bringToFront: async (): Promise<void> => {},
    keyboard: { press: async (): Promise<void> => {} },
    waitForTimeout: async (): Promise<void> => {},
    evaluate: async <Report>(): Promise<Report> => {
      const cleared = status.fillCount >= clearsOnAttempt;
      return (cleared ? "" : promptString) as Report;
    },
    locator: (selector: string) => {
      const isSendButtonTokenInSelector = selector.includes(sendButtonToken);
      return (isSendButtonTokenInSelector ? sendButton : locator).first();
    },
  } as unknown as Page;

  return status;
};
