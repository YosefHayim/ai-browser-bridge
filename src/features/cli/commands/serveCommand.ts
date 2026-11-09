import type { BridgeProviderId } from "@/config.ts";
import type { FanoutTask } from "@/features/bridge/engine/bridgeSchemas.ts";
import { fanOutConversations } from "@/features/bridge/fanout/runBrowserConversations.ts";
import type { FanoutOptions, FanoutResult } from "@/features/bridge/fanout/runConversationTasks.ts";
import {
  type BrowserMcpOperations,
  serveBrowserMcp,
} from "@/features/browserMcp/browserMcpServer.ts";
import type { ConversationSearchResult } from "@/features/conversations/conversationCatalogSchemas.ts";
import { attachmentManifestsDir, repositoryRoot } from "@/features/repoState/paths.ts";
import { providerIdFrom, webProviderFor } from "@/features/webProviders/providerRegistry.ts";
import {
  startChatgptSession,
  startFlowSession,
  withDesignPage,
} from "../browser/browserConnection.ts";
import { startAskEngine } from "../conversations/askCommands.ts";
import type { AskOptions, ServeOptions } from "../presentation/cliTypes.ts";

type ConversationSearchOutcome = {
  ok: boolean;
  results?: ConversationSearchResult[];
  error?: string;
  elapsedMs: number;
};

const fanOutForServe = async (
  tasks: FanoutTask[],
  batchOptions: FanoutOptions,
  base: AskOptions,
): Promise<FanoutResult> => {
  const provider = providerIdFrom(base.provider);
  const engine = await startAskEngine({
    options: { ...base, provider },
    provider,
    supportsMcpConnector: false,
  });
  try {
    if (!engine.browser) {
      throw new Error(
        `Browser not connected. Run \`bridge chrome start --provider ${provider}\` first.`,
      );
    }
    return await fanOutConversations({
      browser: engine.browser,
      config: engine.config,
      tasks,
      manifestRoot: attachmentManifestsDir(),
      options: batchOptions,
    });
  } finally {
    await Promise.allSettled([engine.shutdown({ closeBrowser: false })]);
  }
};

// stdout is JSON-RPC; engine/browser logs must not write there.
export const runServe = async (options: ServeOptions): Promise<void> => {
  const base: AskOptions = { repo: options.repo, port: options.port, timeout: options.timeout };
  const deps: BrowserMcpOperations = {
    repoRoot: repositoryRoot(options.repo),
    fanOut: (tasks, conversationOptions) => fanOutForServe(tasks, conversationOptions, base),
    searchConversations: (providers, query, conversationOptions) =>
      fanoutConversationSearch(providers, query, base, conversationOptions),
    // Each flow_* tool call attaches to the warm browser, drives the Flow page, then
    // shuts the engine down keeping the browser open — mirroring the per-call lifecycle
    // the fan-out `ask` path uses. See the `bridge flow …` CLI runners.
    withFlowPage: async (op) => {
      const { engine, page } = await startFlowSession({ repo: options.repo, port: options.port });
      try {
        return await op(page);
      } finally {
        await Promise.allSettled([engine.shutdown({ closeBrowser: false })]);
      }
    },
    // Each chatgpt_* recon tool attaches to the warm browser, reads the ChatGPT page, then
    // shuts the engine down keeping the browser open — mirroring withFlowPage. See the
    // `bridge chatgpt …` CLI runners.
    withDesignPage: (op) => withDesignPage({ repo: options.repo, port: options.port }, op),
    withChatGptPage: async (op) => {
      const { engine, page } = await startChatgptSession({
        repo: options.repo,
        port: options.port,
      });
      try {
        return await op(page);
      } finally {
        await Promise.allSettled([engine.shutdown({ closeBrowser: false })]);
      }
    },
  };
  await serveBrowserMcp(deps);
};

const fanoutConversationSearch = async (
  providers: BridgeProviderId[],
  query: string,
  options: AskOptions,
  searchOptions: { limit?: number } = {},
): Promise<Record<string, ConversationSearchOutcome>> => {
  const outcomes = await Promise.all(
    providers.map(async (provider): Promise<readonly [string, ConversationSearchOutcome]> => {
      const started = Date.now();
      try {
        const conversationMatches = await searchOneProvider(
          provider,
          query,
          options,
          searchOptions,
        );
        return [
          provider,
          { ok: true, results: conversationMatches, elapsedMs: Date.now() - started },
        ];
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        return [provider, { ok: false, error, elapsedMs: Date.now() - started }];
      }
    }),
  );
  return Object.fromEntries(outcomes);
};

const searchOneProvider = async (
  provider: BridgeProviderId,
  query: string,
  options: AskOptions,
  searchOptions: { limit?: number },
): Promise<ConversationSearchResult[]> => {
  const browserProvider = webProviderFor(provider);
  const engine = await startAskEngine({
    options: { ...options, provider },
    provider,
    supportsMcpConnector: false,
  });
  try {
    const browser = engine.browser;
    if (!browser) {
      throw new Error(
        `Browser not connected. Run \`bridge chrome start --provider ${provider}\` first.`,
      );
    }
    await browserProvider.assertSignedIn(browser.getPage());
    return await engine.getBrowserConversation().searchConversations({
      query,
      limit: searchOptions.limit,
    });
  } finally {
    await Promise.allSettled([engine.shutdown({ closeBrowser: false })]);
  }
};
