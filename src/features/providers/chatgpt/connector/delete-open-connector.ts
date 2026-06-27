import type { Page } from "playwright";
import { firstVisible } from "../dom/first-visible.ts";
import { confirmOpenConnectorDeletion } from "./confirm-open-connector-deletion.ts";

/** Context for {@link deleteOpenConnectorIfPresent}. */
export interface DeleteOpenConnectorIfPresentContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Delete the currently open connector via Manage -> Delete when available. */
export async function deleteOpenConnectorIfPresent(ctx: DeleteOpenConnectorIfPresentContext): Promise<boolean> {
  const manage = await firstVisible({
    page: ctx.page,
    selectors: ['[role="dialog"] button:has-text("Manage")'],
  });
  if (!manage) return false;
  await manage.click({ timeout: 2_000, force: true });
  await ctx.page.waitForTimeout(500);
  return confirmOpenConnectorDeletion({ page: ctx.page });
}
