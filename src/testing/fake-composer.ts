import type { Page } from "playwright";

export interface FakeComposer {
  page: Page;
  fillCount: number;
  sendClickCount: number;
}

interface FakeLocator {
  click: () => Promise<void>;
  fill: () => Promise<void>;
  dispatchEvent: () => Promise<void>;
  waitFor: () => Promise<void>;
  isVisible: () => Promise<boolean>;
  first: () => FakeLocator;
  filter: () => FakeLocator;
  count: () => Promise<number>;
}

export const makeFakeComposer = (
  clearsOnAttempt: number,
  settings: { promptText?: string; sendButtonToken?: string } = {},
): FakeComposer => {
  const prompt = settings.promptText ?? "hello";
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
      return (cleared ? "" : prompt) as Report;
    },
    locator: (selector: string) => {
      const isSendButtonTokenInSelector = selector.includes(sendButtonToken);
      return (isSendButtonTokenInSelector ? sendButton : locator).first();
    },
  } as unknown as Page;

  return status;
};
