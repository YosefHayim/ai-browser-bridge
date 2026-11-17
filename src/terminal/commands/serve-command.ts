import type { AskGatewayCollaborators } from "@/agent-gateway/ask-gateway-server.ts";
import { serveAskGatewayStdio } from "@/agent-gateway/serve-ask-gateway.ts";
import type { FanoutTask } from "@/bridge-engine/bridge-schemas.ts";
import { fanOutConversations } from "@/fan-out/fan-out.ts";
import type { FanoutReport, FanoutSettings } from "@/fan-out/fan-out-pool.ts";
import { readProviderIdFrom } from "@/providers/providers.ts";
import { readAttachmentManifestsDirectory, readRepositoryRoot } from "@/repo-files/paths.ts";
import type { AskSettings, ServeSettings } from "@/terminal/cli/cli-types.ts";
import { startAskEngine, startWorkspaceSession } from "@/terminal/cli/engine-session.ts";
import { readFanoutConversationSearch } from "@/terminal/commands/ask/fan-out.ts";
import { runWithDesignPage } from "@/terminal/commands/design-commands.ts";
import { startFlowSession } from "@/terminal/commands/flow-commands.ts";

async function readFanOutForServe(
  tasks: FanoutTask[],
  batchSettings: FanoutSettings,
  base: AskSettings,
): Promise<FanoutReport> {
  const provider = readProviderIdFrom(base.provider);
  const engine = await startAskEngine({
    options: { ...base, provider },
    provider,
    supportsMcpConnector: false,
  });
  try {
    const isEngineBrowserMissing = engine.browser == null;
    if (isEngineBrowserMissing) {
      throw new Error(
        `Browser not connected. Run \`bridge chrome start --provider ${provider}\` first.`,
      );
    }

    return await fanOutConversations({
      browser: engine.browser,
      config: engine.config,
      tasks,
      manifestRoot: readAttachmentManifestsDirectory(),
      options: batchSettings,
    });
  } finally {
    await Promise.allSettled([engine.shutDown({ closeBrowser: false })]);
  }
}

// stdout is JSON-RPC; engine/browser logs must not write there.
export async function runServe(settings: ServeSettings): Promise<void> {
  const base: AskSettings = { repo: settings.repo, port: settings.port, timeout: settings.timeout };
  const collaborators: AskGatewayCollaborators = {
    repoRoot: readRepositoryRoot(settings.repo),
    fanOut: (tasks, settings) => readFanOutForServe(tasks, settings, base),
    searchConversations: (providers, query, settings) => {
      const providerIds = providers.map((provider) => readProviderIdFrom(provider));

      return readFanoutConversationSearch({
        providers: providerIds,
        query,
        options: base,
        searchOptions: settings,
      });
    },
    withFlowPage: async (op) => {
      const { engine, page } = await startFlowSession({ repo: settings.repo, port: settings.port });

      try {
        return await op(page);
      } finally {
        await Promise.allSettled([engine.shutDown({ closeBrowser: false })]);
      }
    },
    withDesignPage: (op) => runWithDesignPage({ repo: settings.repo, port: settings.port }, op),
    withChatGptPage: async (op) => {
      const { engine, page } = await startWorkspaceSession({
        repo: settings.repo,
        port: settings.port,
      });

      try {
        return await op(page);
      } finally {
        await Promise.allSettled([engine.shutDown({ closeBrowser: false })]);
      }
    },
  };
  await serveAskGatewayStdio(collaborators);
}
