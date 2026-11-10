import type { Page } from "playwright";
import { readIsolatedProfile } from "@/browser/browser-profile.ts";
import {
  BrowserSession,
  getUserProfileDirectoryOnDebugPort,
  isSameProfile,
} from "@/browser/browser-session.ts";
import type { BridgeSettings } from "@/domain/bridge-types.ts";
import { readChatGptConversationUrlFromIdOrUrl } from "@/providers/chatgpt/chatgpt-conversation-url.ts";
import {
  readConversationIdForProviderUrl,
  readProvider,
  readProviderIdFrom,
} from "@/providers/providers.ts";
import type { FanoutTask } from "./bridge-schemas.ts";
import type { FanoutReport, FanoutSettings, FanoutTarget, FanoutTaskReply } from "./fanout-pool.ts";
import { runFanoutTasks } from "./fanout-pool.ts";
import { Orchestrator } from "./orchestrator.ts";

const COMPOSER_WAIT_MS = 30_000;

const readNonEmptyTaskField = (field: string | undefined): string | null => {
  const isFieldMissing = field == null;
  if (isFieldMissing) return null;

  const trimmed = field.trim();

  const isTrimmedEmpty = trimmed.length === 0;
  if (isTrimmedEmpty) return null;

  return trimmed;
};

const readTaskStartUrl = (task: FanoutTask, providerId: string): string | null => {
  const conversation = readNonEmptyTaskField(task.conversation);

  const isConversationMissing = conversation == null;
  if (isConversationMissing) return null;

  // Only ChatGPT builds a thread URL from a bare id; other providers take a full URL as-is.
  const isProviderIdChatgpt = providerId === "chatgpt";
  if (isProviderIdChatgpt) return readChatGptConversationUrlFromIdOrUrl(conversation);

  return conversation;
};

const captureTarget = (page: Page, providerId: string, task: FanoutTask): FanoutTarget => {
  const url = page.url();
  const isolateName = readNonEmptyTaskField(task.isolate);
  let isolate: string | null = null;

  const hasIsolateName = isolateName != null;
  if (hasIsolateName) isolate = isolateName;

  let mode: FanoutTarget["mode"] = "new";

  const hasTaskConversation = readNonEmptyTaskField(task.conversation) != null;
  if (hasTaskConversation) mode = "existing";

  const conversationId = readConversationIdForProviderUrl({ providerId, url });
  return {
    provider: providerId,
    mode,
    id: conversationId,
    url,
    isolate,
  };
};

export const runOneTaskOnTab = async (details: {
  browser: BrowserSession;
  config: BridgeSettings;
  task: FanoutTask;
  manifestRoot?: string;
  timeoutMs?: number;
}): Promise<FanoutTaskReply> => {
  let providerOrigin = details.config.provider;

  const hasTaskProvider = details.task.provider != null;
  if (hasTaskProvider) providerOrigin = details.task.provider;

  const providerId = readProviderIdFrom(providerOrigin);

  // Fan-out closing a tab would cancel a Design turn that runs inside it.
  const isDesignProvider = providerId === "design";
  if (isDesignProvider) {
    throw new Error(
      "Claude Design is not a Fan-out provider — use `bridge design send` or design_send.",
    );
  }

  const provider = readProvider(providerId);
  const taskStartUrl = readTaskStartUrl(details.task, providerId);
  let startUrl = provider.defaultUrl;

  const hasTaskStartUrl = taskStartUrl != null;
  if (hasTaskStartUrl) startUrl = taskStartUrl;

  const page = await details.browser.openTab(startUrl);
  try {
    await Promise.allSettled([
      page.waitForSelector(provider.composerSelector, { timeout: COMPOSER_WAIT_MS }),
    ]);
    await provider.assertSignedIn(page);
    const orchestratorSettings: { manifestRoot?: string } = {};

    const hasDetailsManifestRoot = details.manifestRoot != null;
    if (hasDetailsManifestRoot) {
      orchestratorSettings.manifestRoot = details.manifestRoot;
    }

    const orchestrator = new Orchestrator(
      { ...details.config, provider: providerId },
      provider,
      orchestratorSettings,
    );
    orchestrator.setPage(page);
    let orchestratorError: string | null = null;
    orchestrator.subscribe((event) => {
      const isEventTypeError = event.type === "error";
      if (isEventTypeError) orchestratorError = event.error;
    });
    const sendArguments: { content: string; timeoutMs?: number } = {
      content: details.task.prompt,
    };

    const hasDetailsTimeoutMs = details.timeoutMs != null;
    if (hasDetailsTimeoutMs) sendArguments.timeoutMs = details.timeoutMs;

    const assistantMessage = await orchestrator.sendPrompt(sendArguments);

    const isAssistantMessageMissing = assistantMessage == null;
    if (isAssistantMessageMissing) {
      const hasOrchestratorError = orchestratorError != null;
      if (hasOrchestratorError) throw new Error(orchestratorError);

      throw new Error(`${provider.displayName}: no reply captured.`);
    }

    return {
      reply: assistantMessage.content,
      target: captureTarget(page, providerId, details.task),
    };
  } finally {
    await Promise.allSettled([page.close()]);
  }
};

const launchIsolatedBrowser = async (
  isolateName: string,
  settings: BridgeSettings,
): Promise<BrowserSession> => {
  const { debugPort, profileRoot } = readIsolatedProfile(isolateName);
  const browserSession = new BrowserSession(readProviderIdFrom(settings.provider), {
    debugPort,
    profileRoot,
    browserChoice: "bridge-profile",
  });
  await browserSession.launch();

  // Reject a port collision: a different Chrome already owns this port with another profile.
  const actualProfileRoot = await getUserProfileDirectoryOnDebugPort(debugPort);

  const isProfileRootMismatched =
    actualProfileRoot != null && !isSameProfile(profileRoot, actualProfileRoot);
  if (isProfileRootMismatched) {
    await Promise.allSettled([browserSession.close()]);
    throw new Error(
      `Isolated profile "${isolateName}" expected Chrome on port ${debugPort} to use ${profileRoot}, but found ${actualProfileRoot}. Close that Chrome or pick another isolate name.`,
    );
  }

  return browserSession;
};

export const fanOutConversations = async (details: {
  browser: BrowserSession;
  config: BridgeSettings;
  tasks: readonly FanoutTask[];
  manifestRoot?: string;
  options?: FanoutSettings;
}): Promise<FanoutReport> => {
  const isolatedLanes = new Map<string, Promise<BrowserSession>>();
  const readBrowserForTask = (task: FanoutTask): Promise<BrowserSession> => {
    const isolateName = readNonEmptyTaskField(task.isolate);

    const isIsolateNameMissing = isolateName == null;
    if (isIsolateNameMissing) return Promise.resolve(details.browser);

    const existingLane = isolatedLanes.get(isolateName);

    const hasExistingLane = existingLane != null;
    if (hasExistingLane) return existingLane;

    // Memoize the launch promise so concurrent isolate tasks never double-spawn Chrome.
    const pendingLane = launchIsolatedBrowser(isolateName, details.config);
    isolatedLanes.set(isolateName, pendingLane);
    return pendingLane;
  };
  try {
    return await runFanoutTasks(
      details.tasks,
      async (task) => {
        const taskBrowser = await readBrowserForTask(task);
        const taskRun: {
          browser: BrowserSession;
          config: BridgeSettings;
          task: FanoutTask;
          manifestRoot?: string;
          timeoutMs?: number;
        } = {
          browser: taskBrowser,
          config: details.config,
          task,
        };

        const hasDetailsManifestRoot = details.manifestRoot != null;
        if (hasDetailsManifestRoot) taskRun.manifestRoot = details.manifestRoot;

        const timeoutMsField = details.options?.timeoutMs;
        const hasTimeoutMs = timeoutMsField != null;
        if (hasTimeoutMs) taskRun.timeoutMs = timeoutMsField;

        return runOneTaskOnTab(taskRun);
      },
      details.options,
    );
  } finally {
    await Promise.allSettled(
      [...isolatedLanes.values()].map(async (pendingLane) => {
        const browserSession = await pendingLane;
        await browserSession.close();
      }),
    );
  }
};
