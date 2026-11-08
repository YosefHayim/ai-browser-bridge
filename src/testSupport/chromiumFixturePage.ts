import { type Browser, chromium, type Page } from "playwright";

// Real Chromium, because hidden-versus-rendered is decided by the browser's layout, not by a fake.
export const launchFixtureBrowser = async (): Promise<Browser> => {
  return chromium.launch();
};

export const openFixturePage = async (ctx: { browser: Browser; html: string }): Promise<Page> => {
  const page = await ctx.browser.newPage();
  await page.setContent(ctx.html);
  return page;
};
