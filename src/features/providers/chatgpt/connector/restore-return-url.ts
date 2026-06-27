import { SELECTORS } from "../selectors.config.ts";
import type { ConnectorSetupContext } from "./connector.types.ts";
import { chatGptReturnUrl } from "./chatgpt-return-url.ts";

/** Restore the pre-setup ChatGPT URL and wait for the composer when needed. */
export async function restoreReturnUrlIfNeeded(ctx: ConnectorSetupContext): Promise<void> {
  if (ctx.returnUrl && chatGptReturnUrl({ url: ctx.page.url() }) !== ctx.returnUrl) {
    await ctx.page.goto(ctx.returnUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
  }
  await ctx.page.waitForSelector(SELECTORS.promptInput, { timeout: 15_000 }).catch(() => {});
}
