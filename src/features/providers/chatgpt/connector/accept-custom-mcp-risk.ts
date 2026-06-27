import type { ConnectorSetupContext } from "./connector.types.ts";

/** Context for {@link isRiskCheckboxVisible}. */
export interface IsRiskCheckboxVisibleContext {
  /** Connector setup context with page handle. */
  setup: ConnectorSetupContext;
}

/** True when the custom MCP risk checkbox is visible in the form. */
export async function isRiskCheckboxVisible(ctx: IsRiskCheckboxVisibleContext): Promise<boolean> {
  const checkbox = ctx.setup.page.locator('input[data-testid="trust-checkbox"], input[type="checkbox"]').first();
  if (await checkbox.count() === 0) return false;
  return checkbox.isVisible().catch(() => false);
}

/** Accept the custom MCP risk checkbox when ChatGPT shows it in the form. */
export async function acceptCustomMcpRiskIfPresent(ctx: ConnectorSetupContext): Promise<boolean> {
  if (!await isRiskCheckboxVisible({ setup: ctx })) return false;
  const checkbox = ctx.page.locator('input[data-testid="trust-checkbox"], input[type="checkbox"]').first();
  if (await checkbox.isChecked().catch(() => false)) return true;
  await checkbox.check({ force: true });
  return true;
}
