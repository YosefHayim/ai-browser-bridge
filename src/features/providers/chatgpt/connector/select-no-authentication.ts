import { clickFirstVisible } from "../dom/click-first-visible.ts";
import type { ConnectorSetupContext } from "./connector.types.ts";

/** Select the no-authentication option in the connector form when present. */
export async function selectNoAuthenticationIfPresent(ctx: ConnectorSetupContext): Promise<boolean> {
  const authSelect = ctx.page.locator("select#custom-connector-auth").first();
  if (await authSelect.count() > 0 && await authSelect.isVisible().catch(() => false)) {
    await authSelect.selectOption("NONE");
    await authSelect.dispatchEvent("change").catch(() => {});
    return true;
  }
  return clickFirstVisible({
    page: ctx.page,
    selectors: [
      'button:has-text("No authentication")',
      'button:has-text("No Authentication")',
      'label:has-text("No authentication")',
      'label:has-text("No Authentication")',
      '[role="radio"]:has-text("No authentication")',
      '[role="radio"]:has-text("No Auth")',
      '[role="option"]:has-text("No authentication")',
      '[role="option"]:has-text("No Auth")',
      'button:has-text("No Auth")',
      'button:has-text("None")',
    ],
    timeout: 1_000,
  });
}
