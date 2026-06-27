import type { Page } from "playwright";
import { readComposerText } from "./read-composer-text.ts";

/** Context for {@link composerClearsOnce}. */
export interface ComposerClearsOnceContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Poll the composer once and return true when it has emptied. */
export async function composerClearsOnce(ctx: ComposerClearsOnceContext): Promise<boolean> {
  const composerText = await readComposerText({ page: ctx.page });
  return composerText === "";
}
