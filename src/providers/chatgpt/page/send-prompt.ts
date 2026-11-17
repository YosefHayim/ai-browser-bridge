import type { Page } from "playwright";
import {
  FIVE_SECONDS_MILLISECONDS,
  HALF_SECOND_MILLISECONDS,
} from "@/providers/chatgpt/page/chatgpt-page-constants.ts";
import { SELECTORS } from "@/providers/chatgpt/page/chatgpt-selectors.ts";
import { readComposerString } from "@/providers/chatgpt/page/read-composer-text.ts";
import { isStreamingVisible } from "@/providers/chatgpt/page/wait-for-reply.ts";
import { probeOrFallback } from "@/providers/engine/browser-provider.ts";
import { VISIBLE_WAIT_MODE } from "@/providers/engine/page-probes.ts";

type ClickSendButtonDetails = {
  page: Page;
};

export async function clickSendButton(details: ClickSendButtonDetails): Promise<void> {
  const sendBtn = details.page.locator(SELECTORS.sendButton).filter({ visible: true }).first();

  // The send button may never surface; then the Enter fallback runs.
  const isSendButtonClicked = await probeOrFallback(false, async () => {
    await sendBtn.waitFor({ state: VISIBLE_WAIT_MODE, timeout: FIVE_SECONDS_MILLISECONDS });
    await sendBtn.click();
    return true;
  });
  if (isSendButtonClicked) return;

  // While a response streams, the send slot is the stop button, so Enter would interrupt it.
  const isStreamingShown = await isStreamingVisible({ page: details.page });
  if (isStreamingShown) return;

  await details.page.keyboard.press("Enter");
}

type SubmissionConfirmedDetails = {
  page: Page;
  userTurnsBefore: number;
};

export async function countUserTurns(page: Page): Promise<number> {
  return page.locator(SELECTORS.userBlock).count();
}

async function isSubmissionConfirmed(details: SubmissionConfirmedDetails): Promise<boolean> {
  const composerString = await readComposerString({ page: details.page });

  const isComposerEmpty = composerString === "";
  if (isComposerEmpty) return true;

  const userTurnsNow = await countUserTurns(details.page);

  const isThereNewUserTurn = userTurnsNow > details.userTurnsBefore;
  if (isThereNewUserTurn) return true;

  return isStreamingVisible({ page: details.page });
}

// Attachments can take a while to upload before ChatGPT sends, so the wait is long.
const submissionConfirmPolls = 60;

const submissionConfirmPollMilliseconds = HALF_SECOND_MILLISECONDS;

export async function waitForSubmissionConfirmed(
  details: SubmissionConfirmedDetails,
): Promise<boolean> {
  for (let poll = 0; poll < submissionConfirmPolls; poll += 1) {
    const isSubmissionVerified = await isSubmissionConfirmed(details);
    if (isSubmissionVerified) return true;

    await details.page.waitForTimeout(submissionConfirmPollMilliseconds);
  }
  return false;
}
