import type { Locator } from "playwright";
import { clickDeleteConfirmation } from "./click-delete-confirmation.ts";
import { clickDeleteMenuItem } from "./click-delete-menu-item.ts";

/** Context for {@link clickDeleteMenuEntry}. */
export interface ClickDeleteMenuEntryContext {
  /** Delete menu item locator. */
  deleteItem: Locator;
  /** Playwright page handle for the ChatGPT tab. */
  page: import("playwright").Page;
}

/** Click the delete menu entry and confirm deletion. */
export async function clickDeleteMenuEntry(ctx: ClickDeleteMenuEntryContext): Promise<void> {
  await ctx.deleteItem.click({ timeout: 2_000, force: true });
  await ctx.page.waitForTimeout(500);
  await clickDeleteConfirmation({ page: ctx.page });
}

/** Context for {@link confirmOpenConnectorDeletion}. */
export interface ConfirmOpenConnectorDeletionContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: import("playwright").Page;
}

/** Confirm deletion for the currently open connector detail panel. */
export async function confirmOpenConnectorDeletion(ctx: ConfirmOpenConnectorDeletionContext): Promise<boolean> {
  const deleteItem = await clickDeleteMenuItem({ page: ctx.page });
  if (!deleteItem) return false;
  await clickDeleteMenuEntry({ deleteItem, page: ctx.page });
  return true;
}
