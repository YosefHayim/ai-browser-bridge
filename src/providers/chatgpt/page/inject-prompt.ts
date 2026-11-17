import type { Locator, Page } from "playwright";
import { findVisibleComposer } from "@/providers/chatgpt/page/chatgpt-composer.ts";
import { FORM_CONTROL_TAG } from "@/providers/chatgpt/page/chatgpt-page-constants.ts";
import { waitForGenerationIdle } from "@/providers/chatgpt/page/chatgpt-reply-reader.ts";
import {
  clickSendButton,
  countUserTurns,
  waitForSubmissionConfirmed,
} from "@/providers/chatgpt/page/send-prompt.ts";
import type { InjectPromptSettings } from "@/providers/engine/browser-provider.ts";
import { probeOrFallback } from "@/providers/engine/browser-provider.ts";
import { VISIBLE_WAIT_MODE } from "@/providers/engine/page-probes.ts";

export async function injectPrompt(
  page: Page,
  prompt: string,
  settings: InjectPromptSettings = {},
): Promise<void> {
  await probeOrFallback(null, () => page.bringToFront());
  await runInjectPromptAttempts({ page, text: prompt, beforeSend: settings.beforeSend });
}

type RunInjectPromptAttemptsDetails = {
  page: Page;
  text: string;
  beforeSend: InjectPromptSettings["beforeSend"];
};

type EnsureChatModeDetails = {
  page: Page;
};

export async function ensureChatMode(details: EnsureChatModeDetails): Promise<void> {
  const inactiveChatToggle = details.page
    .locator('button[aria-pressed="false"]')
    .filter({ hasText: /^Chat$/ })
    .first();
  const inactiveChatToggleCount = await inactiveChatToggle.count();

  const hasNoInactiveToggle = inactiveChatToggleCount === 0;
  if (hasNoInactiveToggle) return;

  await inactiveChatToggle.click();
  await findVisibleComposer(details.page).waitFor({ state: VISIBLE_WAIT_MODE });
}

async function runInjectPromptAttempts(details: RunInjectPromptAttemptsDetails): Promise<void> {
  await ensureChatMode({ page: details.page });
  const composer = findVisibleComposer(details.page);
  const maxComposerReadAttempts = 3;

  for (let attempt = 0; attempt < maxComposerReadAttempts; attempt += 1) {
    // Never type or send into a busy conversation — wait out any in-flight response first.
    await waitForGenerationIdle(details.page);

    // A confirmed send returns here and is never sent again; only an unconfirmed one is retried.
    const hasSubmittedPromptAttempt = await submitPromptAttempt({
      page: details.page,
      input: composer,
      text: details.text,
      beforeSend: details.beforeSend,
    });
    if (hasSubmittedPromptAttempt) return;
  }
  throw new Error("injectPrompt: no send was confirmed after 3 attempts");
}

type SubmitPromptAttemptDetails = {
  page: Page;
  input: Locator;
  text: string;
  beforeSend: InjectPromptSettings["beforeSend"];
};

async function submitPromptAttempt(details: SubmitPromptAttemptDetails): Promise<boolean> {
  const userTurnsBefore = await countUserTurns(details.page);

  await details.input.click();
  await details.input.fill(details.text);
  // Filling replaces the draft, so anything added to the composer (the plugin chip) goes in after it.
  await details.beforeSend?.();
  await details.input.dispatchEvent(FORM_CONTROL_TAG);
  await clickSendButton({ page: details.page });

  return waitForSubmissionConfirmed({ page: details.page, userTurnsBefore });
}
