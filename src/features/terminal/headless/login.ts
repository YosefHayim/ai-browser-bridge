import { resolve } from "node:path";
import { BrowserManager } from "../../providers/chrome/browser-manager.ts";
import { getBrowserProvider, normalizeProvider } from "../../providers/create-provider.factory.ts";

/** Options for the non-interactive `bridge login` command. */
export interface LoginOptions {
  repo?: string;
  provider?: string;
}

/**
 * Open the isolated Chrome profile so the user can sign in once.
 * The browser is left running (warm) for subsequent `bridge ask` calls.
 */
export async function runLogin(options: LoginOptions = {}): Promise<void> {
  const browser = await launchLoginBrowser(options);
  writeLoginInstructions(getBrowserProvider(normalizeProvider(options.provider)).displayName);
  process.exit(0);
}

/** Launch the isolated browser profile for sign-in. */
async function launchLoginBrowser(options: LoginOptions): Promise<BrowserManager> {
  const provider = normalizeProvider(options.provider);
  const browser = new BrowserManager(options.repo ? resolve(options.repo) : undefined, provider);
  await browser.launch();
  return browser;
}

/** Print sign-in instructions to stderr. */
function writeLoginInstructions(displayName: string): void {
  process.stderr.write(
    `Bridge Chrome is open for ${displayName} (isolated profile — NOT your daily browser).\n` +
      "If you see a Sign in / Log in button, click it and sign in NOW in this window.\n" +
      "Your main Chrome cookies do not carry over. Sign-in persists across runs.\n" +
      "Leave this window open; `bridge ask` will reconnect to it.\n",
  );
}
