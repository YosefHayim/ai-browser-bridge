import type { Page } from "playwright";
import {
  FIVE_SECONDS_MILLISECONDS,
  HALF_SECOND_MILLISECONDS,
} from "@/providers/chatgpt/page/chatgpt-page-constants.ts";
import { SELECTORS } from "@/providers/chatgpt/page/chatgpt-selectors.ts";
import { readFirstVisible } from "@/providers/chatgpt/page/model-detection.ts";

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

const ATTACHED_FILE_WAIT_POLLS = 40;

const ATTACHED_FILE_POLL_MILLISECONDS = HALF_SECOND_MILLISECONDS;

export async function attachFilesToPrompt(page: Page, paths: string[]): Promise<void> {
  const isPathsEmpty = paths.length === 0;
  if (isPathsEmpty) return;

  const chipsBefore = await page.locator(SELECTORS.attachedFileRemoveButton).count();
  const expectedChips = chipsBefore + paths.length;

  const didAttachFiles = await attachFilesViaFileField({ page, paths });

  const isNotAttachedViaFileField = !didAttachFiles;
  if (isNotAttachedViaFileField) await attachFilesViaChooser({ page, paths });

  const isShownInComposer = await waitForAttachedFileChips({ page, expectedChips });
  if (isShownInComposer) return;

  throw new Error("ChatGPT did not show the attached file in the composer.");
}

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
