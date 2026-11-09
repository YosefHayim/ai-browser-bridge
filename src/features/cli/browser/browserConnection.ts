import { resolve } from "node:path";
import type { Page } from "playwright";
import { startEngine } from "@/features/bridge/engine/bridgeEngine.ts";
import {
  providerIdForUrl,
  providerIdFrom,
  type webProviderFor,
} from "@/features/webProviders/providerRegistry.ts";
import type { BrowserTargetOptions, CliOptions, FlowCmdOptions } from "../presentation/cliTypes.ts";
import { exitWithCliError } from "../presentation/commandOutput.ts";

export const assertSignedIn = async (
  engine: Awaited<ReturnType<typeof startEngine>>,
  browserProvider: ReturnType<typeof webProviderFor>,
  provider: ReturnType<typeof providerIdFrom>,
): Promise<void> => {
  const browser = engine.browser;
  if (!browser) {
    await engine.shutdown({ closeBrowser: false });
    return exitWithCliError(
      `Browser not connected. Run \`bridge chrome start --provider ${provider}\` and sign in if needed.`,
    );
  }
  try {
    await browserProvider.assertSignedIn(browser.getPage());
  } catch (err) {
    await engine.shutdown({ closeBrowser: false });
    exitWithCliError(err instanceof Error ? err.message : String(err));
  }
};

export const debugPortFromOption = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

export const profileRootFromOption = (value: string | undefined): string | undefined => {
  return value ? resolve(value) : undefined;
};

export const requireBrowserPage = (engine: Awaited<ReturnType<typeof startEngine>>): Page => {
  const browser = engine.browser;
  if (!browser) {
    void engine.shutdown({ closeBrowser: false });
    return exitWithCliError(
      "Browser not connected. Run `bridge chrome start` and sign in to ChatGPT if needed.",
    );
  }
  return browser.getPage();
};

export const requireChatgptProvider = (options: CliOptions): void => {
  if (providerIdFrom(options.provider) !== "chatgpt") {
    exitWithCliError(
      "Projects, chat moves, and Scheduled tasks are ChatGPT-only. Omit --provider or pass --provider chatgpt.",
    );
  }
};

export const startChatgptSession = async (options: CliOptions & BrowserTargetOptions) => {
  const engine = await startEngine({
    repoPath: options.repo ? resolve(options.repo) : undefined,
    provider: "chatgpt",
    mcpPort: options.port ? Number(options.port) : undefined,
    withBrowser: true,
    withTools: false,
    debugPort: debugPortFromOption(options.debugPort),
    profileRoot: profileRootFromOption(options.profile),
  });
  return { engine, page: requireBrowserPage(engine) };
};

export const startFlowSession = async (options: FlowCmdOptions) => {
  const engine = await startEngine({
    repoPath: options.repo ? resolve(options.repo) : undefined,
    provider: "flow",
    mcpPort: options.port ? Number(options.port) : undefined,
    withBrowser: true,
    withTools: false,
    debugPort: debugPortFromOption(options.debugPort),
    profileRoot: profileRootFromOption(options.profile),
  });
  return { engine, page: requireBrowserPage(engine) };
};

const DESIGN_ATTACH_WAIT_MS = 30_000;

// Throws instead of exiting so `bridge serve` reports a missing browser per tool call.
const startDesignSession = async (options: CliOptions & BrowserTargetOptions) => {
  const engine = await startEngine({
    repoPath: options.repo ? resolve(options.repo) : undefined,
    provider: "design",
    mcpPort: options.port ? Number(options.port) : undefined,
    withBrowser: true,
    withTools: false,
    persist: false,
    debugPort: debugPortFromOption(options.debugPort),
    profileRoot: profileRootFromOption(options.profile),
  });
  const browser = engine.browser;
  if (!browser) {
    await Promise.allSettled([engine.shutdown({ closeBrowser: false })]);
    throw new Error(
      "Browser not connected. Run `bridge chrome start --provider design` and sign in at claude.ai.",
    );
  }
  // Attaching starts the move to claude.ai/design without awaiting it; a second
  // navigation on the same tab would abort the first, so wait for it to land.
  const page = browser.getPage();
  try {
    await page.waitForURL((url) => providerIdForUrl(url.href) === "design", {
      timeout: DESIGN_ATTACH_WAIT_MS,
    });
  } catch (error) {
    await Promise.allSettled([engine.shutdown({ closeBrowser: false })]);
    throw error;
  }
  return { engine, page };
};

// Each Design call attaches to the warm bridge Chrome, drives one page operation, then
// detaches while leaving Chrome and its tabs open.
export const withDesignPage = async <T>(
  options: CliOptions & BrowserTargetOptions,
  runPage: (page: Page, repoRoot: string) => Promise<T>,
): Promise<T> => {
  const { engine, page } = await startDesignSession(options);
  try {
    return await runPage(page, engine.config.repoPath);
  } finally {
    await Promise.allSettled([engine.shutdown({ closeBrowser: false })]);
  }
};
