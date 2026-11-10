import { resolve } from "node:path";
import type { Page } from "playwright";
import { startEngine } from "@/bridge/bridge-engine.ts";
import type { CommandSession } from "@/domain/command-types.ts";
import { readChatGptConversationIdFromUrl } from "@/providers/chatgpt/chatgpt-conversation-url.ts";
import { type readProvider, readProviderIdFrom } from "@/providers/providers.ts";
import { fail, readCliFailureMessage } from "./cli-failure.ts";
import {
  DEBUG_PORT_FLAG,
  PORT_FLAG,
  parsePortFlag,
  readProfileRootFromOption,
} from "./cli-option-readers.ts";
import type { AskSettings, BrowserTargetSettings, CliSettings } from "./cli-types.ts";

export const CHATGPT_PROVIDER_ID = "chatgpt";

export const readCurrentPage = (commandSession: CommandSession): Page | null => {
  return commandSession.orchestrator.page ?? null;
};

export const readConversationIdFromPage = (page: Page): string => {
  const conversationId = readChatGptConversationIdFromUrl(page.url());

  const isConversationIdMissing = conversationId == null;
  if (isConversationIdMissing) return "current";

  return conversationId;
};

export const assertSignedIn = async (
  engine: Awaited<ReturnType<typeof startEngine>>,
  browserProvider: ReturnType<typeof readProvider>,
  provider: ReturnType<typeof readProviderIdFrom>,
): Promise<void> => {
  const browser = engine.browser;

  const isBrowserMissing = browser == null;
  if (isBrowserMissing) {
    await engine.shutDown({ closeBrowser: false });
    return fail(
      `Browser not connected. Run \`bridge chrome start --provider ${provider}\` and sign in if needed.`,
    );
  }

  try {
    await browserProvider.assertSignedIn(browser.getPage());
  } catch (error) {
    await engine.shutDown({ closeBrowser: false });
    fail(readCliFailureMessage(error));
  }
};

type StartAskEngineDetails = {
  options: AskSettings;
  provider: ReturnType<typeof readProviderIdFrom>;
  supportsMcpConnector: boolean;
};

export const startAskEngine = async (details: StartAskEngineDetails) => {
  const withTools = Boolean(details.options.tools) && details.supportsMcpConnector;

  const isRepoFound = details.options.repo != null && details.options.repo !== "";
  return startEngine({
    repoPath: isRepoFound ? resolve(details.options.repo) : undefined,
    provider: details.provider,
    mcpPort: parsePortFlag(PORT_FLAG, details.options.port),
    withBrowser: true,
    withTools,
    persist: withTools,
    debugPort: parsePortFlag(DEBUG_PORT_FLAG, details.options.debugPort),
    profileRoot: readProfileRootFromOption(details.options.profile),
  });
};

export const requireBrowserPage = (engine: Awaited<ReturnType<typeof startEngine>>): Page => {
  const browser = engine.browser;

  const isBrowserMissing = browser == null;
  if (isBrowserMissing) {
    void engine.shutDown({ closeBrowser: false });
    return fail(
      "Browser not connected. Run `bridge chrome start` and sign in to ChatGPT if needed.",
    );
  }

  return browser.getPage();
};

export const assertChatgptWorkspace = (settings: CliSettings): void => {
  const isNotChatGptProvider = readProviderIdFrom(settings.provider) !== CHATGPT_PROVIDER_ID;
  if (isNotChatGptProvider) {
    fail(
      "Projects, chat moves, and Scheduled tasks are ChatGPT-only. Omit --provider or pass --provider chatgpt.",
    );
  }
};

export const startWorkspaceSession = async (settings: CliSettings & BrowserTargetSettings) => {
  const isRepoFound = settings.repo != null && settings.repo !== "";
  const engine = await startEngine({
    repoPath: isRepoFound ? resolve(settings.repo) : undefined,
    provider: CHATGPT_PROVIDER_ID,
    mcpPort: parsePortFlag(PORT_FLAG, settings.port),
    withBrowser: true,
    withTools: false,
    debugPort: parsePortFlag(DEBUG_PORT_FLAG, settings.debugPort),
    profileRoot: readProfileRootFromOption(settings.profile),
  });

  return { engine, page: requireBrowserPage(engine) };
};
