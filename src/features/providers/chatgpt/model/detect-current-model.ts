import type { Page } from "playwright";
import { readCheckedModelFromDom } from "./read-checked-model-from-dom.ts";
import { readModelFromTrigger } from "./read-model-from-trigger.ts";
import { detectCheckedModelFromMenu } from "./detect-checked-model-from-menu.ts";

/** Detect the currently selected ChatGPT model from the page DOM. */
export async function detectCurrentModel(page: Page): Promise<string> {
  try {
    const fromDom = await readCheckedModelFromDom({ page });
    if (fromDom) return fromDom;
    const fromTrigger = await readModelFromTrigger({ page });
    if (fromTrigger) return fromTrigger;
    const fromMenu = await detectCheckedModelFromMenu({ page });
    return fromMenu ?? "ChatGPT";
  } catch {
    return "ChatGPT";
  }
}
