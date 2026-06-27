import { firstVisible } from "../dom/first-visible.ts";
import type { ConnectorSetupContext } from "./connector.types.ts";

/** Navigate back to the connector list from a detail panel when Back is visible. */
export async function returnToConnectorListIfNeeded(ctx: ConnectorSetupContext): Promise<void> {
  const back = await firstVisible({
    page: ctx.page,
    selectors: ['[role="dialog"] button:has-text("Back")'],
  });
  if (back) {
    await back.click({ timeout: 2_000, force: true }).catch(() => {});
    await ctx.page.waitForTimeout(750);
  }
}
