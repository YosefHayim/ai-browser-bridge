import { errors, type Page } from "playwright";
import { ensureChatMode } from "@/providers/chatgpt/page/chatgpt-composer.ts";
import {
  CHATGPT_PROVIDER_ID,
  FIFTEEN_SECONDS_MILLISECONDS,
  LIST_SEPARATOR,
} from "@/providers/chatgpt/page/chatgpt-page-constants.ts";
import { SELECTORS } from "@/providers/chatgpt/page/chatgpt-selectors.ts";
import { readFirstVisible } from "@/providers/chatgpt/page/model-detection.ts";
import { VISIBLE_WAIT_MODE } from "@/providers/engine/page-probes.ts";
import { createGuestSessionError } from "@/providers/engine/provider-errors.ts";

export class ChatGptSession {
  constructor(private readonly page: Page) {}

  assertSignedIn = async (): Promise<void> => {
    await ensureChatMode({ page: this.page });

    const isGuestSessionDetected = await this.isGuestSession();
    if (isGuestSessionDetected) {
      throw createGuestSessionError({
        providerId: CHATGPT_PROVIDER_ID,
        reason:
          "Run `bridge chrome start --provider chatgpt`, click Log in if needed, complete sign-in, leave Chrome open, then run again.",
      });
    }
  };

  private waitForSessionSignal = async (): Promise<void> => {
    const sessionSignalSelectors = [
      ...SELECTORS.accountMenuButton,
      ...SELECTORS.guestLoginButton,
      SELECTORS.promptInput,
    ];
    const sessionSignalCssSelector = sessionSignalSelectors.join(LIST_SEPARATOR);
    const sessionSignal = this.page
      .locator(sessionSignalCssSelector)
      .filter({ visible: true })
      .first();

    try {
      await sessionSignal.waitFor({
        state: VISIBLE_WAIT_MODE,
        timeout: SESSION_SIGNAL_TIMEOUT_MILLISECONDS,
      });
    } catch (error) {
      const isSessionSignalSlow = error instanceof errors.TimeoutError;
      if (isSessionSignalSlow) return;

      throw error;
    }
  };

  private isGuestSession = async (): Promise<boolean> => {
    await this.waitForSessionSignal();

    const hasAccountMenuVisible = await hasVisibleAccountMenu({ page: this.page });
    if (hasAccountMenuVisible) return false;

    const hasGuestLoginVisible = await hasGuestLoginButtons({ page: this.page });
    if (hasGuestLoginVisible) return true;

    return !(await hasVisibleComposer({ page: this.page }));
  };
}

type HasGuestLoginButtonsDetails = {
  page: Page;
};

async function hasGuestLoginButtons(details: HasGuestLoginButtonsDetails): Promise<boolean> {
  const loginButton = await readFirstVisible({
    parent: details.page,
    selectors: SELECTORS.guestLoginButton,
  });
  return loginButton != null;
}

type HasVisibleAccountMenuDetails = {
  page: Page;
};

async function hasVisibleAccountMenu(details: HasVisibleAccountMenuDetails): Promise<boolean> {
  const accountMenu = await readFirstVisible({
    parent: details.page,
    selectors: SELECTORS.accountMenuButton,
  });
  return accountMenu != null;
}

type HasVisibleComposerDetails = {
  page: Page;
};

async function hasVisibleComposer(details: HasVisibleComposerDetails): Promise<boolean> {
  const composer = await readFirstVisible({
    parent: details.page,
    selectors: [SELECTORS.promptInput],
  });
  return composer != null;
}

const SESSION_SIGNAL_TIMEOUT_MILLISECONDS = FIFTEEN_SECONDS_MILLISECONDS;
