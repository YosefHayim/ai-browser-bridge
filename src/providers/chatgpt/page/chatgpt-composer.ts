import type { Locator, Page } from "playwright";
import { PROVIDER_SETTINGS } from "@/provider-settings.ts";
import {
  FIVE_SECONDS_MILLISECONDS,
  FORM_CONTROL_TAG,
  HALF_SECOND_MILLISECONDS,
} from "@/providers/chatgpt/page/chatgpt-page-constants.ts";
import {
  ChatGptReplyReader,
  isStreamingVisible,
} from "@/providers/chatgpt/page/chatgpt-reply-reader.ts";
import { SELECTORS } from "@/providers/chatgpt/page/chatgpt-selectors.ts";
import { readFirstVisible } from "@/providers/chatgpt/page/model-detection.ts";
import type { InjectPromptSettings } from "@/providers/engine/browser-provider.ts";
import { probeOrFallback } from "@/providers/engine/browser-provider.ts";
import { VISIBLE_WAIT_MODE } from "@/providers/engine/page-probes.ts";

export const ATTACHED_FILE_REMOVE_BUTTON_SELECTOR = 'form button[aria-label^="Remove "]';

const attachedFileRemovePolls = 20;
const attachedFileRemovePollMilliseconds = 250;

export class ChatGptComposer {
  constructor(private readonly page: Page) {}

  // ChatGPT keeps a hidden copy of the composer in the page, so a lookup must pick the rendered one.
  findVisibleComposer = (): Locator => {
    return this.page
      .locator(PROVIDER_SETTINGS.chatgpt.selectors.composer)
      .filter({ visible: true })
      .first();
  };

  private findVisibleAttachedFileRemoveButton = (): Locator => {
    return this.page
      .locator(ATTACHED_FILE_REMOVE_BUTTON_SELECTOR)
      .filter({ visible: true })
      .first();
  };

  countVisibleAttachedFiles = async (): Promise<number> => {
    return this.page
      .locator(ATTACHED_FILE_REMOVE_BUTTON_SELECTOR)
      .filter({ visible: true })
      .count();
  };

  // The remove button only takes clicks while its file tile is hovered.
  private hoverFirstAttachedFileTile = async (): Promise<void> => {
    await this.page
      .locator('form [class~="group/composer-attachment"]')
      .filter({ visible: true })
      .first()
      .hover();
  };

  removeComposerAttachments = async (): Promise<void> => {
    const attachedFileCount = await this.countVisibleAttachedFiles();

    for (let removal = 0; removal < attachedFileCount; removal += 1) {
      const remainingAfterRemoval = attachedFileCount - removal - 1;
      await this.hoverFirstAttachedFileTile();
      await this.findVisibleAttachedFileRemoveButton().click();
      await waitForVisibleAttachedFileCount({
        page: this.page,
        expectedCount: remainingAfterRemoval,
      });
    }
  };

  attachFilesToPrompt = async (paths: string[]): Promise<void> => {
    const isPathsEmpty = paths.length === 0;
    if (isPathsEmpty) return;

    const chipsBefore = await this.page.locator(SELECTORS.attachedFileRemoveButton).count();
    const expectedChips = chipsBefore + paths.length;

    const didAttachFiles = await attachFilesViaFileField({ page: this.page, paths });

    const isNotAttachedViaFileField = !didAttachFiles;
    if (isNotAttachedViaFileField) await attachFilesViaChooser({ page: this.page, paths });

    const isShownInComposer = await waitForAttachedFileChips({ page: this.page, expectedChips });
    if (isShownInComposer) return;

    throw new Error("ChatGPT did not show the attached file in the composer.");
  };

  stopGenerating = async (timeout = FIVE_SECONDS_MILLISECONDS): Promise<boolean> => {
    const stop = this.page.locator(SELECTORS.streamingIndicator).first();

    const isStopShown = await probeOrFallback(false, async () => {
      await stop.waitFor({ state: VISIBLE_WAIT_MODE, timeout });
      return true;
    });

    const isStopMissing = !isStopShown;
    if (isStopMissing) return false;

    await stop.click();

    return true;
  };

  injectPrompt = async (prompt: string, settings: InjectPromptSettings = {}): Promise<void> => {
    await probeOrFallback(null, () => this.page.bringToFront());
    await runInjectPromptAttempts({
      page: this.page,
      text: prompt,
      beforeSend: settings.beforeSend,
    });
  };

  countUserTurns = async (): Promise<number> => {
    return this.page.locator(SELECTORS.userBlock).count();
  };
}

type WaitForVisibleAttachedFileCountDetails = {
  page: Page;
  expectedCount: number;
};

async function waitForVisibleAttachedFileCount(
  details: WaitForVisibleAttachedFileCountDetails,
): Promise<void> {
  for (let poll = 0; poll < attachedFileRemovePolls; poll += 1) {
    const visibleCount = await new ChatGptComposer(details.page).countVisibleAttachedFiles();

    const isExpectedCountReached = visibleCount <= details.expectedCount;
    if (isExpectedCountReached) return;

    await details.page.waitForTimeout(attachedFileRemovePollMilliseconds);
  }
  throw new Error("ChatGPT kept an attached file in the composer after removing it.");
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

const ATTACHED_FILE_WAIT_POLLS = 40;

const ATTACHED_FILE_POLL_MILLISECONDS = HALF_SECOND_MILLISECONDS;

type WaitForAttachedFileChipsDetails = {
  page: Page;
  expectedChips: number;
};

async function waitForAttachedFileChips(
  details: WaitForAttachedFileChipsDetails,
): Promise<boolean> {
  for (let poll = 0; poll < ATTACHED_FILE_WAIT_POLLS; poll += 1) {
    const chipCount = await details.page.locator(SELECTORS.attachedFileRemoveButton).count();

    const hasEveryChip = chipCount >= details.expectedChips;
    if (hasEveryChip) return true;

    await details.page.waitForTimeout(ATTACHED_FILE_POLL_MILLISECONDS);
  }
  return false;
}

type OpenAttachmentFileChooserDetails = {
  page: Page;
};

async function openAttachmentFileChooser(details: OpenAttachmentFileChooserDetails) {
  const attachMenuButton = await readFirstVisible({
    parent: details.page,
    selectors: SELECTORS.attachmentMenuButton,
  });

  const isAttachMenuButtonMissing = attachMenuButton == null;
  if (isAttachMenuButtonMissing) throw new Error("Could not find ChatGPT attachment control.");

  await attachMenuButton.click();
  const attachFilesElement = details.page
    .getByRole("button", { name: SELECTORS.attachmentMenuItem })
    .filter({ visible: true })
    .first();
  const chooserPromise = details.page.waitForEvent("filechooser", {
    timeout: FIVE_SECONDS_MILLISECONDS,
  });
  const elementClick = attachFilesElement.click();
  const [chooser] = await Promise.all([chooserPromise, elementClick]);
  return chooser;
}

type AttachFilesViaChooserDetails = {
  page: Page;
  paths: string[];
};

async function attachFilesViaChooser(details: AttachFilesViaChooserDetails): Promise<void> {
  const chooser = await openAttachmentFileChooser({ page: details.page });
  await chooser.setFiles(details.paths);
}

type AttachFilesViaFileFieldDetails = {
  page: Page;
  paths: string[];
};

async function attachFilesViaFileField(details: AttachFilesViaFileFieldDetails): Promise<boolean> {
  const attachmentField = details.page.locator(SELECTORS.attachmentInput).first();
  const fileFieldCount = await attachmentField.count();

  const hasNoFileField = fileFieldCount === 0;
  if (hasNoFileField) return false;

  await attachmentField.setInputFiles(details.paths);
  return true;
}

type ReadComposerStringDetails = {
  page: Page;
};

export async function readComposerString(details: ReadComposerStringDetails): Promise<string> {
  const composerDraft = await details.page.evaluate((selector) => {
    function isRendered(element: Element): boolean {
      return element.getClientRects().length > 0;
    }
    const prompt = [...document.querySelectorAll<HTMLElement>(selector)].find(isRendered);

    const isThereNoRenderedComposer = prompt == null;
    if (isThereNoRenderedComposer) return "";

    const promptField: unknown = Reflect.get(prompt, "value");

    const isTypeString = typeof promptField === "string";
    if (isTypeString) return promptField.trim();

    // biome-ignore lint/performance/useDomNodeTextContent: the prompt copy must match what the user sees
    return (prompt.innerText ?? prompt.textContent ?? "").trim();
  }, SELECTORS.promptInput);

  const isDraftMissing = composerDraft == null;
  if (isDraftMissing) return "";

  return composerDraft;
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
  await new ChatGptComposer(details.page)
    .findVisibleComposer()
    .waitFor({ state: VISIBLE_WAIT_MODE });
}

async function runInjectPromptAttempts(details: RunInjectPromptAttemptsDetails): Promise<void> {
  await ensureChatMode({ page: details.page });
  const composer = new ChatGptComposer(details.page).findVisibleComposer();
  const maxComposerReadAttempts = 3;

  for (let attempt = 0; attempt < maxComposerReadAttempts; attempt += 1) {
    // Never type or send into a busy conversation — wait out any in-flight response first.
    await new ChatGptReplyReader(details.page).waitForGenerationIdle();

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
  const userTurnsBefore = await new ChatGptComposer(details.page).countUserTurns();

  await details.input.click();
  await details.input.fill(details.text);
  // Filling replaces the draft, so anything added to the composer (the plugin chip) goes in after it.
  await details.beforeSend?.();
  await details.input.dispatchEvent(FORM_CONTROL_TAG);
  await clickSendButton({ page: details.page });

  return waitForSubmissionConfirmed({ page: details.page, userTurnsBefore });
}

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

async function isSubmissionConfirmed(details: SubmissionConfirmedDetails): Promise<boolean> {
  const composerString = await readComposerString({ page: details.page });

  const isComposerEmpty = composerString === "";
  if (isComposerEmpty) return true;

  const userTurnsNow = await new ChatGptComposer(details.page).countUserTurns();

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
