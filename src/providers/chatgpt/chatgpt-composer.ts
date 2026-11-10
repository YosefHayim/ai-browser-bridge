import type { Locator, Page } from "playwright";
import { PROVIDER_SETTINGS } from "@/config";

export const ATTACHED_FILE_REMOVE_BUTTON_SELECTOR = 'form button[aria-label^="Remove "]';

const attachedFileRemovePolls = 20;
const attachedFileRemovePollMilliseconds = 250;

// ChatGPT keeps a hidden copy of the composer in the page, so a lookup must pick the rendered one.
export const findVisibleComposer = (page: Page): Locator => {
  return page
    .locator(PROVIDER_SETTINGS.chatgpt.selectors.composer)
    .filter({ visible: true })
    .first();
};

const findVisibleAttachedFileRemoveButton = (page: Page): Locator => {
  return page.locator(ATTACHED_FILE_REMOVE_BUTTON_SELECTOR).filter({ visible: true }).first();
};

const countVisibleAttachedFiles = async (page: Page): Promise<number> => {
  return page.locator(ATTACHED_FILE_REMOVE_BUTTON_SELECTOR).filter({ visible: true }).count();
};

type WaitForVisibleAttachedFileCountDetails = {
  page: Page;
  expectedCount: number;
};

const waitForVisibleAttachedFileCount = async (
  details: WaitForVisibleAttachedFileCountDetails,
): Promise<void> => {
  for (let poll = 0; poll < attachedFileRemovePolls; poll += 1) {
    const visibleCount = await countVisibleAttachedFiles(details.page);

    const isExpectedCountReached = visibleCount <= details.expectedCount;
    if (isExpectedCountReached) return;

    await details.page.waitForTimeout(attachedFileRemovePollMilliseconds);
  }
  throw new Error("ChatGPT kept an attached file in the composer after removing it.");
};

// The remove button only takes clicks while its file tile is hovered.
const hoverFirstAttachedFileTile = async (page: Page): Promise<void> => {
  await page
    .locator('form [class~="group/composer-attachment"]')
    .filter({ visible: true })
    .first()
    .hover();
};

export const removeComposerAttachments = async (page: Page): Promise<void> => {
  const attachedFileCount = await countVisibleAttachedFiles(page);
  for (let removal = 0; removal < attachedFileCount; removal += 1) {
    const remainingAfterRemoval = attachedFileCount - removal - 1;
    await hoverFirstAttachedFileTile(page);
    await findVisibleAttachedFileRemoveButton(page).click();
    await waitForVisibleAttachedFileCount({ page, expectedCount: remainingAfterRemoval });
  }
};
