import type { Page } from "playwright";
import { startEngine } from "@/bridge-engine/bridge-engine.ts";
import type { CommandSession } from "@/command-types.ts";
import { readChatGptConversationIdFromUrl } from "@/providers/chatgpt/backend-api/chatgpt-conversation-url.ts";
import { createProvider, readProviderIdFrom } from "@/providers/providers.ts";
import { readErrorMessage } from "@/read-error-message.ts";
import { fail } from "@/terminal/cli/cli-failure.ts";
import { readAbsolutePathFromOption } from "@/terminal/cli/cli-option-readers.ts";
import type { AskSettings, BrowserTargetSettings, CliSettings } from "@/terminal/cli/cli-types.ts";

export const CHATGPT_PROVIDER_ID = "chatgpt";

export function readCurrentPage(commandSession: CommandSession): Page | null {
  return commandSession.orchestrator.page;
}

export function readConversationIdFromPage(page: Page): string {
  const conversationId = readChatGptConversationIdFromUrl(page.url());

  const isConversationIdMissing = conversationId == null;
  if (isConversationIdMissing) return "current";

  return conversationId;
}

export async function assertSignedIn(
  engine: Awaited<ReturnType<typeof startEngine>>,
  provider: ReturnType<typeof readProviderIdFrom>,
): Promise<void> {
  const browser = engine.browser;

  const isBrowserMissing = browser == null;
  if (isBrowserMissing) {
    await engine.shutDown({ closeBrowser: false });
    return fail(
      `Browser not connected. Run \`bridge chrome start --provider ${provider}\` and sign in if needed.`,
    );
  }

  try {
    await createProvider(provider, browser.getPage()).assertSignedIn();
  } catch (error) {
    await engine.shutDown({ closeBrowser: false });
    fail(readErrorMessage(error));
  }
}

type StartAskEngineDetails = {
  options: AskSettings;
  provider: ReturnType<typeof readProviderIdFrom>;
  supportsMcpConnector: boolean;
};

export async function startAskEngine(details: StartAskEngineDetails) {
  const withTools = Boolean(details.options.tools) && details.supportsMcpConnector;

  return startEngine({
    repoPath: readAbsolutePathFromOption(details.options.repo),
    provider: details.provider,
    mcpPort: details.options.port,
    withBrowser: true,
    withTools,
    persist: withTools,
    debugPort: details.options.debugPort,
    profileRoot: readAbsolutePathFromOption(details.options.profile),
  });
}

export async function requireBrowserPage(
  engine: Awaited<ReturnType<typeof startEngine>>,
): Promise<Page> {
  const browser = engine.browser;

  const isBrowserMissing = browser == null;
  if (isBrowserMissing) {
    await shutDownQuietly(engine);
    return fail(
      "Browser not connected. Run `bridge chrome start` and sign in to ChatGPT if needed.",
    );
  }

  return browser.getPage();
}

async function shutDownQuietly(engine: Awaited<ReturnType<typeof startEngine>>): Promise<void> {
  try {
    await engine.shutDown({ closeBrowser: false });
  } catch (error) {
    process.stderr.write(`Could not shut the engine down: ${readErrorMessage(error)}\n`);
  }
}

export function assertChatgptWorkspace(settings: CliSettings): void {
  const isNotChatGptProvider = readProviderIdFrom(settings.provider) !== CHATGPT_PROVIDER_ID;
  if (isNotChatGptProvider) {
    fail(
      "Projects, chat moves, and Scheduled tasks are ChatGPT-only. Omit --provider or pass --provider chatgpt.",
    );
  }
}

export async function startWorkspaceSession(settings: CliSettings & BrowserTargetSettings) {
  const engine = await startEngine({
    repoPath: readAbsolutePathFromOption(settings.repo),
    provider: CHATGPT_PROVIDER_ID,
    mcpPort: settings.port,
    withBrowser: true,
    withTools: false,
    debugPort: settings.debugPort,
    profileRoot: readAbsolutePathFromOption(settings.profile),
  });

  return { engine, page: await requireBrowserPage(engine) };
}
