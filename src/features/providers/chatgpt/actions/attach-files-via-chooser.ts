import type { Page } from "playwright";
import { firstVisible } from "../dom/first-visible.ts";

/** Context for {@link openAttachmentFileChooser}. */
export interface OpenAttachmentFileChooserContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Open the attachment file chooser via the composer attach button. */
export async function openAttachmentFileChooser(ctx: OpenAttachmentFileChooserContext) {
  const attachButton = await firstVisible({ page: ctx.page, selectors: [
    'button[aria-label*="Attach" i]',
    'button[aria-label*="Upload" i]',
    'button[data-testid*="attach" i]',
    'button[data-testid*="upload" i]',
  ] });
  if (!attachButton) throw new Error("Could not find ChatGPT attachment control.");
  const chooserPromise = ctx.page.waitForEvent("filechooser", { timeout: 5_000 });
  await attachButton.click();
  return chooserPromise;
}

/** Context for {@link attachFilesViaChooser}. */
export interface AttachFilesViaChooserContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Local file paths to attach. */
  paths: string[];
}

/** Attach files by clicking the attachment button and using the file chooser. */
export async function attachFilesViaChooser(ctx: AttachFilesViaChooserContext): Promise<void> {
  const chooser = await openAttachmentFileChooser({ page: ctx.page });
  await (await chooser).setFiles(ctx.paths);
}
