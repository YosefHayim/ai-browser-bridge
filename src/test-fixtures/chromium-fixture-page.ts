import { type Browser, chromium, type Page } from "playwright";

// Real Chromium, because hidden-versus-rendered is decided by the browser's layout, not by a fake.
export async function launchFixtureBrowser(): Promise<Browser> {
  return chromium.launch();
}

export async function openFixturePage(fixture: { browser: Browser; html: string }): Promise<Page> {
  const page = await fixture.browser.newPage();
  await page.setContent(fixture.html);
  return page;
}
