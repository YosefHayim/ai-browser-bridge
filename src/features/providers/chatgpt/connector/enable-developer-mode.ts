import { ENABLE_DEVELOPER_MODE_SNIPPET } from "./enable-developer-mode.dom-snippet.ts";
import type { ConnectorSetupContext } from "./connector.types.ts";

/** Enable Developer mode via in-page toggle discovery when available. */
export async function enableDeveloperModeIfPresent(ctx: ConnectorSetupContext): Promise<void> {
  const outcome = await ctx.page.evaluate(ENABLE_DEVELOPER_MODE_SNIPPET);
  if (outcome === "enabled") {
    ctx.result.steps.push("Enabled Developer mode.");
    await ctx.page.waitForTimeout(750);
    return;
  }
  if (outcome === "already-enabled") {
    ctx.result.steps.push("Developer mode was already enabled.");
    return;
  }
  ctx.result.warnings.push("Could not find the Developer mode toggle. It may already be enabled or unavailable for this account/workspace.");
}
