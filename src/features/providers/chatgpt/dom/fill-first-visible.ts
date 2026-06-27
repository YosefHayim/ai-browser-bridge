import type { Locator } from "playwright";
import { firstVisible } from "./first-visible.ts";

/** Context for {@link fillFirstVisible}. */
export interface FillFirstVisibleContext {
  /** Playwright page handle to search within. */
  page: import("playwright").Page;
  /** Candidate field selectors to fill in order. */
  selectors: readonly string[];
  /** Value to write into the first visible field. */
  value: string;
}

/** Context for {@link fillVisibleField}. */
export interface FillVisibleFieldContext {
  /** Visible input locator to fill. */
  field: Locator;
  /** Value to write into the field. */
  value: string;
}

/** Fill one visible field and dispatch input/change events. */
export async function fillVisibleField(ctx: FillVisibleFieldContext): Promise<void> {
  await ctx.field.fill(ctx.value);
  await ctx.field.dispatchEvent("input").catch(() => {});
  await ctx.field.dispatchEvent("change").catch(() => {});
}

/** Fill the first visible input matching any selector; return whether a field was filled. */
export async function fillFirstVisible(ctx: FillFirstVisibleContext): Promise<boolean> {
  const field = await firstVisible({ page: ctx.page, selectors: ctx.selectors });
  if (!field) return false;
  await fillVisibleField({ field, value: ctx.value });
  return true;
}
