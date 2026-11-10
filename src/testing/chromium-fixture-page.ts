import { type Browser, chromium, type Page } from "playwright";

// Real Chromium, because hidden-versus-rendered is decided by the browser's layout, not by a fake.
export const launchFixtureBrowser = async (): Promise<Browser> => {
  return chromium.launch();
};

export const openFixturePage = async (fixture: {
  browser: Browser;
  html: string;
}): Promise<Page> => {
  const page = await fixture.browser.newPage();
  await page.setContent(fixture.html);
  return page;
};
