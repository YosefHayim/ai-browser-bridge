import type { Page } from "playwright";
import { SELECTORS } from "../selectors.config.ts";
import type { ResponseWaitOptions } from "./response-wait-options.ts";
import { parseResponseWaitOptions, waitForStreamingToFinish } from "./wait-for-streaming-to-finish.ts";
import { waitForLastAssistantTextStable } from "./wait-for-last-assistant-text-stable.ts";
import { waitForResponseAfterBaseline } from "./wait-for-response-after-baseline.ts";
import { remainingTimeout } from "./remaining-timeout.ts";

/** Wait for ChatGPT to finish streaming its response. */
export async function waitForResponse(
  page: Page,
  options: number | ResponseWaitOptions = {},
): Promise<void> {
  const parsed = parseResponseWaitOptions(options);
  const startedAt = Date.now();
  if (parsed.previousAssistantCount !== undefined || parsed.previousLastAssistantText) {
    await waitForResponseAfterBaseline({ page, ...parsed });
  } else {
    await page.waitForSelector(SELECTORS.responseBlock, { timeout: parsed.timeout });
  }
  await waitForStreamingToFinish({ page, startedAt, timeout: parsed.timeout });
  await waitForLastAssistantTextStable({
    page,
    timeout: remainingTimeout({ startedAt, timeout: parsed.timeout }),
  });
}
