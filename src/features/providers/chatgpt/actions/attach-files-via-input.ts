import type { Page } from "playwright";
import { SELECTORS } from "../selectors.config.ts";

/** Context for {@link attachFilesViaInput}. */
export interface AttachFilesViaInputContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Local file paths to attach. */
  paths: string[];
}

/** Attach files through a visible file input when one exists. */
export async function attachFilesViaInput(ctx: AttachFilesViaInputContext): Promise<boolean> {
  const input = ctx.page.locator(SELECTORS.attachmentInput).first();
  if (await input.count() === 0) return false;
  await input.setInputFiles(ctx.paths);
  return true;
}
