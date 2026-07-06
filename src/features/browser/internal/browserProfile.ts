import { homedir } from "node:os";
import { join } from "node:path";

export const CHROME_APP_NAME_ENV = "AI_BROWSER_BRIDGE_CHROME_APP";
export const DEFAULT_CHROME_APP_NAME = "Google Chrome";

/**
 * Shared Chrome profile used by bridge-launched debug sessions.
 *
 * @param home - Home directory used as the profile parent.
 * @returns The shared global bridge Chrome profile directory.
 * @example
 * ```ts
 * const profileRoot = bridgeChromeProfileRoot();
 * ```
 */
export const bridgeChromeProfileRoot = (home: string = homedir()): string => {
  return join(home, ".ai-browser-bridge", "chrome-profile");
};

/**
 * Chrome app name used by macOS `open -na` when launching the bridge browser.
 *
 * @param env - Environment map that may contain `AI_BROWSER_BRIDGE_CHROME_APP`.
 * @returns The configured Chrome app name, or the regular Google Chrome app name.
 * @example
 * ```ts
 * const appName = chromeAppName({
 *   AI_BROWSER_BRIDGE_CHROME_APP: "Google Chrome for Testing",
 * });
 * ```
 */
export const chromeAppName = (env: NodeJS.ProcessEnv = process.env): string => {
  const configuredName = env[CHROME_APP_NAME_ENV]?.trim();
  return configuredName && configuredName.length > 0 ? configuredName : DEFAULT_CHROME_APP_NAME;
};
