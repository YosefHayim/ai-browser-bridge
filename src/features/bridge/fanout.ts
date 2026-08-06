import type { Page } from "playwright";
import {
  BrowserSession,
  getUserDataDirOnDebugPort,
  isolatedProfile,
  profilesMatch,
} from "@/features/browser";
import type { BridgeConfig } from "@/features/domain";
import {
  chatGptConversationIdFromUrl,
  chatGptConversationUrlFromIdOrUrl,
  providerFor,
  providerIdFrom,
} from "@/features/providers";
import type { FanoutTask } from "./bridgeSchemas.ts";
import type { FanoutOptions, FanoutResult, FanoutTarget, FanoutTaskReply } from "./fanoutPool.ts";
import { runFanoutTasks } from "./fanoutPool.ts";
import { Orchestrator } from "./orchestrator.ts";

const COMPOSER_WAIT_MS = 30_000;

const nonEmptyTaskField = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed;
};

const taskStartUrl = (task: FanoutTask, providerId: string): string | undefined => {
  const conversation = nonEmptyTaskField(task.conversation);
  if (conversation === undefined) return undefined;
  // Only ChatGPT builds a thread URL from a bare id; other providers take a full URL as-is.
  if (providerId === "chatgpt") return chatGptConversationUrlFromIdOrUrl(conversation);
  return conversation;
};

const captureTarget = (page: Page, providerId: string, task: FanoutTask): FanoutTarget => {
  const url = page.url();
  const isolateName = nonEmptyTaskField(task.isolate);
  let isolate: string | null = null;
  if (isolateName !== undefined) isolate = isolateName;
  let mode: FanoutTarget["mode"] = "new";
  if (nonEmptyTaskField(task.conversation) !== undefined) mode = "existing";
  let conversationId: string | null = null;
  if (providerId === "chatgpt") conversationId = chatGptConversationIdFromUrl(url);
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
  if (input.task.provider !== undefined) providerSource = input.task.provider;
  const providerId = providerIdFrom(providerSource);
  const provider = providerFor(providerId);
  const resolvedStartUrl = taskStartUrl(input.task, providerId);
  let startUrl = provider.defaultUrl;
  if (resolvedStartUrl !== undefined) startUrl = resolvedStartUrl;
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
      if (event.type === "error") orchestratorError = event.error;
    });
    const sendInput: { content: string; timeoutMs?: number } = {
      content: input.task.prompt,
    };
    if (input.timeoutMs !== undefined) sendInput.timeoutMs = input.timeoutMs;
    const assistantMessage = await orchestrator.sendPrompt(sendInput);
    if (assistantMessage === null) {
      if (orchestratorError !== null) throw new Error(orchestratorError);
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
  const browserSession = new BrowserSession(providerIdFrom(config.provider), {
    debugPort,
    profileRoot,
  });
  await browserSession.launch();
  // Reject a port collision: a different Chrome already owns this port with another profile.
  const actualProfileRoot = await getUserDataDirOnDebugPort(debugPort);
  if (actualProfileRoot !== null && !profilesMatch(profileRoot, actualProfileRoot)) {
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
    if (isolateName === undefined) return Promise.resolve(input.browser);
    const existingLane = isolatedLanes.get(isolateName);
    if (existingLane !== undefined) return existingLane;
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
