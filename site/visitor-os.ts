export type VisitorOs = "macos" | "windows" | "linux";

interface NavigatorWithPlatform extends Navigator {
  userAgentData?: { platform?: string };
}

const readOsFromText = (text: string): VisitorOs | undefined => {
  if (/iPhone|iPad|iPod/i.test(text)) return "macos";
  if (/Android/i.test(text)) return "linux";
  if (/Windows/i.test(text)) return "windows";
  if (/Mac/i.test(text)) return "macos";
  if (/Linux|X11|Ubuntu|Fedora|CrOS/i.test(text)) return "linux";
  return undefined;
};

export const detectVisitorOs = (): VisitorOs => {
  const browser: NavigatorWithPlatform = navigator;
  const platformText = browser.userAgentData?.platform ?? "";
  const isAndroidPlatform = /Android/i.test(browser.userAgent);

  return (
    (isAndroidPlatform ? "linux" : undefined) ??
    readOsFromText(platformText) ??
    readOsFromText(browser.userAgent) ??
    "macos"
  );
};

/** Marks the page with the visitor's OS once, so the CSS can pick the terminal chrome and prompt. */
export const showVisitorOs = () => {
  document.documentElement.dataset.visitorOs = detectVisitorOs();
};
