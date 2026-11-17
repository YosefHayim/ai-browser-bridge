import type { Locator, Page } from "playwright";
import { probeOrFallback } from "@/providers/engine/browser-provider.ts";
import { ESCAPE_KEY, HTML_PARSED_WAIT, VISIBLE_WAIT_MODE } from "@/providers/engine/page-probes.ts";

export const CHATGPT_MENU_ITEM = '[role="menuitem"]';

const menuItemShownMilliseconds = 4_000;

const POINTER_DOWN_EVENT = "pointerdown";

const MOUSE_POINTER_DOWN = {
  button: 0,
  isPrimary: true,
  pointerType: "mouse",
} as const;

export async function isLocatorWaitMet(
  locator: Locator,
  waitSettings: { state: "attached" | "visible"; timeout: number },
): Promise<boolean> {
  return probeOrFallback(false, async () => {
    await locator.waitFor(waitSettings);
    return true;
  });
}

// A menu renders after its trigger fires; wait for the item instead of sampling once.
export function isMenuElementShown(
  element: Locator,
  timeout = menuItemShownMilliseconds,
): Promise<boolean> {
  return isLocatorWaitMet(element, { state: VISIBLE_WAIT_MODE, timeout });
}

export class ChatGptPageControls {
  constructor(private readonly page: Page) {}

  // Fresh tabs abort goto mid-navigation, so retry once after settle.
  gotoStable = async (url: string): Promise<void> => {
    const maxGotoAttempts = 2;
    for (let attempt = 0; attempt < maxGotoAttempts; attempt += 1) {
      try {
        await this.page.goto(url, { waitUntil: HTML_PARSED_WAIT });
        return;
      } catch (error) {
        const isInterrupted = /interrupted by another navigation/i.test(String(error));

        const isInterruptedOnFirstAttempt = attempt === 0 && isInterrupted;
        if (!isInterruptedOnFirstAttempt) throw error;

        await probeOrFallback(null, () => this.page.waitForLoadState(HTML_PARSED_WAIT));
      }
    }
  };

  dismissMenu = async (): Promise<void> => {
    await probeOrFallback(null, () => this.page.keyboard.press(ESCAPE_KEY));
    await probeOrFallback(null, () => this.page.keyboard.press(ESCAPE_KEY));
  };

  // Overlapping links and sticky headers intercept coordinate clicks, so fire pointerdown on the node.
  firePointerDown = async (trigger: Locator, timeout?: number): Promise<void> => {
    await trigger.dispatchEvent(POINTER_DOWN_EVENT, MOUSE_POINTER_DOWN, { timeout });
  };
}
