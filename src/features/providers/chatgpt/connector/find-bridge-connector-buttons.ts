import type { Page } from "playwright";
import type { Locator } from "playwright";
import { BRIDGE_CONNECTOR_PREFIX } from "../connector.constants.ts";
import { normalizeConnectorListLabel } from "./connector-summary-helpers.ts";

/** Context for {@link findBridgeConnectorButtons}. */
export interface FindBridgeConnectorButtonsContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Find bridge connector buttons in the open settings dialog. */
export async function findBridgeConnectorButtons(ctx: FindBridgeConnectorButtonsContext): Promise<Array<{ button: Locator; name: string }>> {
  const buttons = await ctx.page.locator('[role="dialog"] button').all();
  const entries: Array<{ button: Locator; name: string }> = [];
  for (const button of buttons) {
    const label = normalizeConnectorListLabel({ value: await button.innerText().catch(() => "") });
    if (label.startsWith(BRIDGE_CONNECTOR_PREFIX)) {
      entries.push({ button, name: label });
    }
  }
  return entries;
}
