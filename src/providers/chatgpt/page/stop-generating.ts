import type { Page } from "playwright";
import { FIVE_SECONDS_MILLISECONDS } from "@/providers/chatgpt/page/chatgpt-page-constants.ts";
import { SELECTORS } from "@/providers/chatgpt/page/chatgpt-selectors.ts";
import { probeOrFallback } from "@/providers/engine/browser-provider.ts";
import { VISIBLE_WAIT_MODE } from "@/providers/engine/page-probes.ts";

export async function stopGenerating(
  page: Page,
  timeout = FIVE_SECONDS_MILLISECONDS,
): Promise<boolean> {
  const stop = page.locator(SELECTORS.streamingIndicator).first();

  const isStopShown = await probeOrFallback(false, async () => {
    await stop.waitFor({ state: VISIBLE_WAIT_MODE, timeout });
    return true;
  });

  const isStopMissing = !isStopShown;
  if (isStopMissing) return false;

  await stop.click();

  return true;
}
