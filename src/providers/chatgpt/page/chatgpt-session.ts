import { errors, type Page } from "playwright";
import {
  CHATGPT_PROVIDER_ID,
  FIFTEEN_SECONDS_MILLISECONDS,
  LIST_SEPARATOR,
} from "@/providers/chatgpt/page/chatgpt-page-constants.ts";
import { SELECTORS } from "@/providers/chatgpt/page/chatgpt-selectors.ts";
import { ensureChatMode } from "@/providers/chatgpt/page/inject-prompt.ts";
import { readFirstVisible } from "@/providers/chatgpt/page/model-detection.ts";
import { VISIBLE_WAIT_MODE } from "@/providers/engine/page-probes.ts";
import { createGuestSessionError } from "@/providers/engine/provider-errors.ts";

export async function assertSignedIn(page: Page): Promise<void> {
  await ensureChatMode({ page });

  const isGuestSessionDetected = await isGuestSession(page);
  if (isGuestSessionDetected) {
    throw createGuestSessionError({
      providerId: CHATGPT_PROVIDER_ID,
      reason:
        "Run `bridge chrome start --provider chatgpt`, click Log in if needed, complete sign-in, leave Chrome open, then run again.",
    });
  }
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

async function waitForSessionSignal(page: Page): Promise<void> {
  const sessionSignalSelectors = [
    ...SELECTORS.accountMenuButton,
    ...SELECTORS.guestLoginButton,
    SELECTORS.promptInput,
  ];
  const sessionSignalCssSelector = sessionSignalSelectors.join(LIST_SEPARATOR);
  const sessionSignal = page.locator(sessionSignalCssSelector).filter({ visible: true }).first();

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
}

async function isGuestSession(page: Page): Promise<boolean> {
  await waitForSessionSignal(page);

  const hasAccountMenuVisible = await hasVisibleAccountMenu({ page });
  if (hasAccountMenuVisible) return false;

  const hasGuestLoginVisible = await hasGuestLoginButtons({ page });
  if (hasGuestLoginVisible) return true;

  return !(await hasVisibleComposer({ page }));
}
