import type { Page } from "playwright";
import type { FanOutTask } from "@/bridge-engine/bridge-schemas.ts";
import type { BridgeSettings } from "@/bridge-types.ts";
import {
  getUserProfileDirectoryOnDebugPort,
  isSameProfile,
} from "@/browser/bridge-chrome-processes.ts";
import { readIsolatedProfile } from "@/browser/browser-profile.ts";
import { BrowserSession } from "@/browser/browser-session.ts";
import type {
  FanOutReport,
  FanOutSettings,
  FanOutTarget,
  FanOutTaskReply,
} from "@/fan-out/fan-out-pool.ts";
import { runFanOutTasks } from "@/fan-out/fan-out-pool.ts";
import { Orchestrator } from "@/orchestrator/orchestrator.ts";
import { readChatGptConversationUrlFromIdOrUrl } from "@/providers/chatgpt/backend-api/chatgpt-conversation-url.ts";
import {
  createProvider,
  readConversationIdForProviderUrl,
  readProviderIdFrom,
  readProviderProfile,
} from "@/providers/providers.ts";

const COMPOSER_WAIT_MILLISECONDS = 30_000;

function readNonEmptyTaskField(field: string | undefined): string | null {
  const isFieldMissing = field == null;
  if (isFieldMissing) return null;

  const trimmed = field.trim();

  const isTrimmedEmpty = trimmed.length === 0;
  if (isTrimmedEmpty) return null;

  return trimmed;
}

function readTaskStartUrl(task: FanOutTask, providerId: string): string | null {
  const conversation = readNonEmptyTaskField(task.conversation);

  const isConversationMissing = conversation == null;
  if (isConversationMissing) return null;

  // Only ChatGPT builds a thread URL from a bare id; other providers take a full URL as-is.
  const isProviderIdChatgpt = providerId === "chatgpt";
  if (isProviderIdChatgpt) return readChatGptConversationUrlFromIdOrUrl(conversation);

  return conversation;
}

function captureTarget(page: Page, providerId: string, task: FanOutTask): FanOutTarget {
  const url = page.url();
  const isolateName = readNonEmptyTaskField(task.isolate);
  let isolate: string | null = null;

  const hasIsolateName = isolateName != null;
  if (hasIsolateName) isolate = isolateName;

  let mode: FanOutTarget["mode"] = "new";

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
}

export async function runOneTaskOnTab(details: {
  browser: BrowserSession;
  bridgeSettings: BridgeSettings;
  task: FanOutTask;
  manifestRoot?: string;
  timeoutMilliseconds?: number;
}): Promise<FanOutTaskReply> {
  let providerOrigin = details.bridgeSettings.provider;

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

  const profile = readProviderProfile(providerId);
  const taskStartUrl = readTaskStartUrl(details.task, providerId);
  let startUrl = profile.defaultUrl;

  const hasTaskStartUrl = taskStartUrl != null;
  if (hasTaskStartUrl) startUrl = taskStartUrl;

  const page = await details.browser.openTab(startUrl);
  try {
    const provider = createProvider(providerId, page);
    await Promise.allSettled([
      page.waitForSelector(profile.composerSelector, { timeout: COMPOSER_WAIT_MILLISECONDS }),
    ]);
    await provider.assertSignedIn();
    const orchestratorSettings: { manifestRoot?: string } = {};

    const hasDetailsManifestRoot = details.manifestRoot != null;
    if (hasDetailsManifestRoot) {
      orchestratorSettings.manifestRoot = details.manifestRoot;
    }

    const orchestrator = new Orchestrator(
      { ...details.bridgeSettings, provider: providerId },
      orchestratorSettings,
    );
    orchestrator.setPage(page);
    const errorMessages: string[] = [];
    orchestrator.subscribe((event) => {
      const isEventTypeError = event.type === "error";
      if (isEventTypeError) errorMessages.push(event.error);
    });
    const sendArguments: { content: string; timeoutMilliseconds?: number } = {
      content: details.task.prompt,
    };

    const hasDetailsTimeoutMilliseconds = details.timeoutMilliseconds != null;
    if (hasDetailsTimeoutMilliseconds)
      sendArguments.timeoutMilliseconds = details.timeoutMilliseconds;

    const assistantMessage = await orchestrator.sendPrompt(sendArguments);

    const isAssistantMessageMissing = assistantMessage == null;
    if (isAssistantMessageMissing) {
      const lastErrorMessage = errorMessages.at(-1);

      const hasOrchestratorError = lastErrorMessage != null;
      if (hasOrchestratorError) throw new Error(lastErrorMessage);

      throw new Error(`${profile.displayName}: no reply captured.`);
    }

    return {
      reply: assistantMessage.content,
      target: captureTarget(page, providerId, details.task),
    };
  } finally {
    await Promise.allSettled([page.close()]);
  }
}

async function launchIsolatedBrowser(
  isolateName: string,
  settings: BridgeSettings,
): Promise<BrowserSession> {
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
}

export async function fanOutConversations(details: {
  browser: BrowserSession;
  bridgeSettings: BridgeSettings;
  tasks: readonly FanOutTask[];
  manifestRoot?: string;
  options?: FanOutSettings;
}): Promise<FanOutReport> {
  const isolatedLanes = new Map<string, Promise<BrowserSession>>();
  function readBrowserForTask(task: FanOutTask): Promise<BrowserSession> {
    const isolateName = readNonEmptyTaskField(task.isolate);

    const isIsolateNameMissing = isolateName == null;
    if (isIsolateNameMissing) return Promise.resolve(details.browser);

    const existingLane = isolatedLanes.get(isolateName);

    const hasExistingLane = existingLane != null;
    if (hasExistingLane) return existingLane;

    // Memoize the launch promise so concurrent isolate tasks never double-spawn Chrome.
    const pendingLane = launchIsolatedBrowser(isolateName, details.bridgeSettings);
    isolatedLanes.set(isolateName, pendingLane);
    return pendingLane;
  }
  try {
    return await runFanOutTasks(
      details.tasks,
      async (task) => {
        const taskBrowser = await readBrowserForTask(task);
        const taskRun: {
          browser: BrowserSession;
          bridgeSettings: BridgeSettings;
          task: FanOutTask;
          manifestRoot?: string;
          timeoutMilliseconds?: number;
        } = {
          browser: taskBrowser,
          bridgeSettings: details.bridgeSettings,
          task,
        };

        const hasDetailsManifestRoot = details.manifestRoot != null;
        if (hasDetailsManifestRoot) taskRun.manifestRoot = details.manifestRoot;

        const timeoutMillisecondsField = details.options?.timeoutMilliseconds;

        const hasTimeoutMilliseconds = timeoutMillisecondsField != null;
        if (hasTimeoutMilliseconds) taskRun.timeoutMilliseconds = timeoutMillisecondsField;

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
}
