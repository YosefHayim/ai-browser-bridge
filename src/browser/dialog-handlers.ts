import type { BrowserContext, Page } from "playwright";

const pagesWiredForDialogs = new WeakSet<Page>();

// Dismiss JS alerts/confirms without crashing when CDP races Playwright's dialog manager.
export function wireSafeDialogHandlers(page: Page): void {
  const isPageAlreadyWired = pagesWiredForDialogs.has(page);
  if (isPageAlreadyWired) return;

  pagesWiredForDialogs.add(page);
  page.on("dialog", (dialog) => {
    void Promise.allSettled([dialog.dismiss()]);
  });
}

export function wireSafeDialogHandlersInProfile(profile: BrowserContext): void {
  for (const page of profile.pages()) wireSafeDialogHandlers(page);
  profile.on("page", (page) => wireSafeDialogHandlers(page));
}
