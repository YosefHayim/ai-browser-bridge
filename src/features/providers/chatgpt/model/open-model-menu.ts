import type { Page } from "playwright";
import { SELECTORS } from "../selectors.config.ts";
import { firstVisible } from "../dom/first-visible.ts";

/** Context for {@link clickModelTrigger}. */
export interface ClickModelTriggerContext {
  /** Model switcher trigger locator. */
  trigger: NonNullable<Awaited<ReturnType<typeof firstVisible>>>;
}

/** Click the model switcher trigger, forcing if needed. */
export async function clickModelTrigger(ctx: ClickModelTriggerContext): Promise<void> {
  try {
    await ctx.trigger.click({ timeout: 5_000 });
  } catch {
    await ctx.trigger.click({ timeout: 5_000, force: true });
  }
}

/** Context for {@link openModelMenu}. */
export interface OpenModelMenuContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Open the ChatGPT model switcher dropdown menu. */
export async function openModelMenu(ctx: OpenModelMenuContext): Promise<void> {
  await ctx.page.locator(SELECTORS.modelTrigger.join(", ")).first()
    .waitFor({ state: "visible", timeout: 5_000 })
    .catch(() => {});
  const trigger = await firstVisible({ page: ctx.page, selectors: SELECTORS.modelTrigger });
  if (!trigger) throw new Error("Could not find ChatGPT model switcher button.");
  await clickModelTrigger({ trigger });
  await ctx.page.locator(SELECTORS.openMenu).first().waitFor({ state: "visible", timeout: 5_000 });
}
