import type { Page } from "playwright";
import { READ_COMPOSER_TEXT_SNIPPET } from "./composer-text.dom-snippet.ts";

/** Context for {@link readComposerText}. */
export interface ReadComposerTextContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Read the current trimmed text from the ChatGPT composer. */
export async function readComposerText(ctx: ReadComposerTextContext): Promise<string> {
  return ctx.page.evaluate(READ_COMPOSER_TEXT_SNIPPET);
}
