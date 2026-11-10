import type { Page } from "playwright";
import { isolatedProfile } from "@/browser/browser-profile.ts";
import {
  BrowserSession,
  getUserDataDirOnDebugPort,
  profilesMatch,
} from "@/browser/browser-session.ts";
import type { BridgeConfig } from "@/domain/bridge-types.ts";
import { chatGptConversationUrlFromIdOrUrl } from "@/providers/chatgpt/chatgpt-conversation-url.ts";
import {
  readConversationIdForProviderUrl,
  readProvider,
  readProviderIdFrom,
} from "@/providers/providers.ts";
import type { FanoutTask } from "./bridge-schemas.ts";
import type { FanoutOptions, FanoutResult, FanoutTarget, FanoutTaskReply } from "./fanout-pool.ts";
import { runFanoutTasks } from "./fanout-pool.ts";
import { Orchestrator } from "./orchestrator.ts";

const COMPOSER_WAIT_MS = 30_000;

const nonEmptyTaskField = (value: string | undefined): string | undefined => {
  const isValueMissing = value === undefined;
  if (isValueMissing) return undefined;

  const trimmed = value.trim();

  const isTrimmedEmpty = trimmed.length === 0;
  if (isTrimmedEmpty) return undefined;

  return trimmed;
};

const taskStartUrl = (task: FanoutTask, providerId: string): string | undefined => {
  const conversation = nonEmptyTaskField(task.conversation);

  const isConversationMissing = conversation === undefined;
  if (isConversationMissing) return undefined;

  // Only ChatGPT builds a thread URL from a bare id; other providers take a full URL as-is.
  const isProviderIdChatgpt = providerId === "chatgpt";
  if (isProviderIdChatgpt) return chatGptConversationUrlFromIdOrUrl(conversation);

  return conversation;
};

const captureTarget = (page: Page, providerId: string, task: FanoutTask): FanoutTarget => {
  const url = page.url();
  const isolateName = nonEmptyTaskField(task.isolate);
  let isolate: string | null = null;

  const hasIsolateName = isolateName !== undefined;
  if (hasIsolateName) isolate = isolateName;

  let mode: FanoutTarget["mode"] = "new";

  const hasTaskConversation = nonEmptyTaskField(task.conversation) !== undefined;
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

/**
 * Drive one fan-out task on its own fresh tab, then close the tab.
 *
 * Opens a page in the given browser (a new Conversation, or an existing one when the task
 * carries a `conversation`), drives the turn through a per-task Orchestrator bound to
 * that page, captures the reply and Conversation target, and always closes the tab so peak
 * memory tracks the pool size, not the task count.
 */
export const runOneTaskOnTab = async (input: {
  browser: BrowserSession;
  config: BridgeConfig;
  task: FanoutTask;
  manifestRoot?: string;
  timeoutMs?: number;
}): Promise<FanoutTaskReply> => {
  let providerSource = input.config.provider;

  const hasTaskProvider = input.task.provider !== undefined;
  if (hasTaskProvider) providerSource = input.task.provider;

  const providerId = readProviderIdFrom(providerSource);

  // Fan-out closes each tab when its task ends, which would cancel a Design turn that
  // runs inside the tab.
  const isProviderIdDesign = providerId === "design";
  if (isProviderIdDesign) {
    throw new Error(
      "Claude Design is not a Fan-out provider — use `bridge design send` or design_send.",
    );
  }

  const provider = readProvider(providerId);
  const resolvedStartUrl = taskStartUrl(input.task, providerId);
  let startUrl = provider.defaultUrl;

  const hasResolvedStartUrl = resolvedStartUrl !== undefined;
  if (hasResolvedStartUrl) startUrl = resolvedStartUrl;

  const page = await input.browser.openTab(startUrl);
  try {
    await Promise.allSettled([
      page.waitForSelector(provider.composerSelector, { timeout: COMPOSER_WAIT_MS }),
    ]);
    await provider.assertSignedIn(page);
    const orchestratorOptions: { manifestRoot?: string } = {};

    if (input.manifestRoot !== undefined) {
      orchestratorOptions.manifestRoot = input.manifestRoot;
    }

    const orchestrator = new Orchestrator(
      { ...input.config, provider: providerId },
      provider,
      orchestratorOptions,
    );
    orchestrator.setPage(page);
    let orchestratorError: string | null = null;
    orchestrator.on((event) => {
      const isEventTypeError = event.type === "error";
      if (isEventTypeError) orchestratorError = event.error;
    });
    const sendInput: { content: string; timeoutMs?: number } = {
      content: input.task.prompt,
    };

    if (input.timeoutMs !== undefined) sendInput.timeoutMs = input.timeoutMs;

    const assistantMessage = await orchestrator.sendPrompt(sendInput);

    const isAssistantMessageMissing = assistantMessage === null;
    if (isAssistantMessageMissing) {
      const hasOrchestratorError = orchestratorError !== null;
      if (hasOrchestratorError) throw new Error(orchestratorError);

      throw new Error(`${provider.displayName}: no reply captured.`);
    }

    return {
      reply: assistantMessage.content,
      target: captureTarget(page, providerId, input.task),
    };
  } finally {
    await Promise.allSettled([page.close()]);
  }
};

const launchIsolatedBrowser = async (
  isolateName: string,
  config: BridgeConfig,
): Promise<BrowserSession> => {
  const { debugPort, profileRoot } = isolatedProfile(isolateName);
  const browserSession = new BrowserSession(readProviderIdFrom(config.provider), {
    debugPort,
    profileRoot,
    browserChoice: "bridge-profile",
  });
  await browserSession.launch();

  // Reject a port collision: a different Chrome already owns this port with another profile.
  const actualProfileRoot = await getUserDataDirOnDebugPort(debugPort);
  const isProfileRootMismatched =
    actualProfileRoot !== null && !profilesMatch(profileRoot, actualProfileRoot);
  if (isProfileRootMismatched) {
    await Promise.allSettled([browserSession.close()]);
    throw new Error(
      `Isolated profile "${isolateName}" expected Chrome on port ${debugPort} to use ${profileRoot}, but found ${actualProfileRoot}. Close that Chrome or pick another isolate name.`,
    );
  }

  return browserSession;
};

/**
 * Run an ordered fan-out against the warm shared browser, opening one tab per task.
 *
 * Tasks without `isolate` share the passed-in browser (the one signed-in Chrome); tasks with
 * `isolate` are grouped by name onto a lazily launched second Chrome that is signed in once
 * and reused for the run, then disconnected. Scheduling, concurrency, truncation, and
 * pagination all come from runFanoutTasks; this layer only supplies the browser work.
 */
export const fanOutConversations = async (input: {
  browser: BrowserSession;
  config: BridgeConfig;
  tasks: readonly FanoutTask[];
  manifestRoot?: string;
  options?: FanoutOptions;
}): Promise<FanoutResult> => {
  const isolatedLanes = new Map<string, Promise<BrowserSession>>();
  const browserForTask = (task: FanoutTask): Promise<BrowserSession> => {
    const isolateName = nonEmptyTaskField(task.isolate);

    const isIsolateNameMissing = isolateName === undefined;
    if (isIsolateNameMissing) return Promise.resolve(input.browser);

    const existingLane = isolatedLanes.get(isolateName);

    const hasExistingLane = existingLane !== undefined;
    if (hasExistingLane) return existingLane;

    // Memoize the launch promise so concurrent isolate tasks never double-spawn Chrome.
    const pendingLane = launchIsolatedBrowser(isolateName, input.config);
    isolatedLanes.set(isolateName, pendingLane);
    return pendingLane;
  };
  try {
    return await runFanoutTasks(
      input.tasks,
      async (task) => {
        const taskInput: {
          browser: BrowserSession;
          config: BridgeConfig;
          task: FanoutTask;
          manifestRoot?: string;
          timeoutMs?: number;
        } = {
          browser: await browserForTask(task),
          config: input.config,
          task,
        };

        if (input.manifestRoot !== undefined) taskInput.manifestRoot = input.manifestRoot;

        if (input.options?.timeoutMs !== undefined) taskInput.timeoutMs = input.options.timeoutMs;

        return runOneTaskOnTab(taskInput);
      },
      input.options,
    );
  } finally {
    await Promise.allSettled(
      [...isolatedLanes.values()].map((pendingLane) =>
        pendingLane.then((browserSession) => browserSession.close()),
      ),
    );
  }
};
