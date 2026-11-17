import type { Page } from "playwright";
import type { FanOutTask } from "@/bridge-engine/bridge-schemas.ts";
import type { BridgeSettings } from "@/bridge-types.ts";
import { readIsolatedProfile } from "@/browser/browser-profile.ts";
import {
  BrowserSession,
  getUserProfileDirectoryOnDebugPort,
  isSameProfile,
} from "@/browser/browser-session.ts";
import type {
  FanOutConversation,
  FanOutConversationReply,
  FanOutReport,
  FanOutSettings,
} from "@/fan-out/fan-out-pool.ts";
import { runFanOutTasks } from "@/fan-out/fan-out-pool.ts";
import { Orchestrator, type OrchestratorEvent } from "@/orchestrator/orchestrator.ts";
import { readChatGptConversationUrlFromIdOrUrl } from "@/providers/chatgpt/backend-api/chatgpt-conversation-url.ts";
import {
  createProvider,
  readConversationIdForProviderUrl,
  readProviderIdFrom,
  readProviderProfile,
} from "@/providers/providers.ts";
import { readErrorMessage } from "@/read-error-message.ts";

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

function readIsolateName(task: FanOutTask): string | null {
  return readNonEmptyTaskField(task.isolate);
}

function captureConversation(page: Page, providerId: string, task: FanOutTask): FanOutConversation {
  const url = page.url();
  const isolate = readIsolateName(task);

  const hasTaskConversation = readNonEmptyTaskField(task.conversation) != null;
  const mode = hasTaskConversation ? "existing" : "new";

  const conversationId = readConversationIdForProviderUrl({ providerId, url });
  return { provider: providerId, mode, id: conversationId, url, isolate };
}

function readRunSettings(details: ConversationRunDetails): {
  manifestRoot?: string;
  timeoutMilliseconds?: number;
} {
  const runSettings: { manifestRoot?: string; timeoutMilliseconds?: number } = {};

  const hasManifestRoot = details.manifestRoot != null;
  if (hasManifestRoot) runSettings.manifestRoot = details.manifestRoot;

  const hasTimeoutMilliseconds = details.timeoutMilliseconds != null;
  if (hasTimeoutMilliseconds) runSettings.timeoutMilliseconds = details.timeoutMilliseconds;

  return runSettings;
}

interface ConversationRunDetails {
  browser: BrowserSession;
  bridgeSettings: BridgeSettings;
  task: FanOutTask;
  manifestRoot?: string;
  timeoutMilliseconds?: number;
}

export async function runConversationOnTab(
  details: ConversationRunDetails,
): Promise<FanOutConversationReply> {
  const providerOrigin = details.task.provider ?? details.bridgeSettings.provider;
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
  const startUrl = taskStartUrl ?? profile.defaultUrl;
  const runSettings = readRunSettings(details);

  const page = await details.browser.openTab(startUrl);
  try {
    const provider = createProvider(providerId, page);
    await Promise.allSettled([
      page.waitForSelector(profile.composerSelector, { timeout: COMPOSER_WAIT_MILLISECONDS }),
    ]);
    await provider.assertSignedIn();

    const orchestrator = new Orchestrator(
      { ...details.bridgeSettings, provider: providerId },
      { manifestRoot: runSettings.manifestRoot },
    );
    orchestrator.setPage(page);
    const errorMessages: string[] = [];

    function collectErrorMessage(event: OrchestratorEvent): void {
      const isEventTypeError = event.type === "error";
      if (isEventTypeError) errorMessages.push(event.error);
    }

    orchestrator.subscribe(collectErrorMessage);

    const assistantMessage = await orchestrator.sendPrompt({
      content: details.task.prompt,
      timeoutMilliseconds: runSettings.timeoutMilliseconds,
    });

    const isAssistantMessageMissing = assistantMessage == null;
    if (isAssistantMessageMissing) {
      const lastErrorMessage = errorMessages.at(-1);

      const hasOrchestratorError = lastErrorMessage != null;
      if (hasOrchestratorError) throw new Error(lastErrorMessage);

      throw new Error(`${profile.displayName}: no reply captured.`);
    }

    return {
      reply: assistantMessage.content,
      target: captureConversation(page, providerId, details.task),
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

async function closeIsolatedLane(pendingLane: Promise<BrowserSession>): Promise<void> {
  try {
    const browserSession = await pendingLane;
    await browserSession.close();
  } catch (error) {
    const reason = readErrorMessage(error);
    process.stderr.write(`Fan-out: could not close an isolated browser (${reason}).\n`);
  }
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
    const isolateName = readIsolateName(task);

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

  async function runTask(task: FanOutTask): Promise<FanOutConversationReply> {
    const taskBrowser = await readBrowserForTask(task);

    return runConversationOnTab({
      browser: taskBrowser,
      bridgeSettings: details.bridgeSettings,
      task,
      manifestRoot: details.manifestRoot,
      timeoutMilliseconds: details.options?.timeoutMilliseconds,
    });
  }

  try {
    return await runFanOutTasks(details.tasks, runTask, details.options);
  } finally {
    const lanes = [...isolatedLanes.values()];
    await Promise.all(lanes.map(closeIsolatedLane));
  }
}
