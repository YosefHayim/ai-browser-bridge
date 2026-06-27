import type { Page } from "playwright";
import { SELECTORS } from "../selectors.config.ts";
import { firstVisible } from "../dom/first-visible.ts";
import { normalizeDisplayText } from "../dom/normalize-display-text.ts";
import { readLikelyModelLine } from "./read-likely-model-line.ts";
import { readLikelyAriaModelLabel } from "./read-likely-aria-model-label.ts";

/** Context for {@link readModelFromTrigger}. */
export interface ReadModelFromTriggerContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Read the current model label from the model switcher trigger button. */
export async function readModelFromTrigger(ctx: ReadModelFromTriggerContext): Promise<string | null> {
  const trigger = await firstVisible({ page: ctx.page, selectors: SELECTORS.modelTrigger });
  if (!trigger) return null;
  const line = readLikelyModelLine({
    text: normalizeDisplayText({ value: await trigger.innerText().catch(() => "") }),
  });
  if (line) return line;
  return readLikelyAriaModelLabel({ trigger });
}
