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

/** How long a freshly opened tab waits for the provider composer before asking. */
const COMPOSER_WAIT_MS = 30_000;

/** Resolve a task's `conversation` to a start URL, or undefined for a new Conversation. */
const taskStartUrl = (task: FanoutTask, providerId: string): string | undefined => {
  if (!task.conversation) return undefined;
  // Only ChatGPT builds a thread URL from a bare id; other providers take a full URL as-is.
  if (providerId === "chatgpt") return chatGptConversationUrlFromIdOrUrl(task.conversation);
  return task.conversation;
};

/** Read back the Conversation a task landed on so the caller can reopen it later. */
const captureTarget = (page: Page, providerId: string, task: FanoutTask): FanoutTarget => {
  const url = page.url();
  let isolate: string | null = null;
  if (task.isolate) isolate = task.isolate;
  return {
    provider: providerId,
    mode: task.conversation ? "existing" : "new",
    id: providerId === "chatgpt" ? chatGptConversationIdFromUrl(url) : null,
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
    await page
      .waitForSelector(provider.composerSelector, { timeout: COMPOSER_WAIT_MS })
      .catch(() => {});
    await provider.assertSignedIn(page);
    const orchestrator = new Orchestrator(
      { ...input.config, provider: providerId },
      provider,
      input.manifestRoot !== undefined ? { manifestRoot: input.manifestRoot } : {},
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
    const reply = await orchestrator.sendPrompt(sendInput);
    if (!reply) {
      if (orchestratorError !== null) throw new Error(orchestratorError);
      throw new Error(`${provider.displayName}: no reply captured.`);
    }
    return { reply: reply.content, target: captureTarget(page, providerId, input.task) };
  } finally {
    await page.close().catch(() => {});
  }
};

/** Launch (or reuse) a signed-in isolated-profile Chrome and verify it owns its profile. */
const launchIsolatedBrowser = async (
  name: string,
  config: BridgeConfig,
): Promise<BrowserSession> => {
  const { debugPort, profileRoot } = isolatedProfile(name);
  const browserSession = new BrowserSession(providerIdFrom(config.provider), {
    debugPort,
    profileRoot,
  });
  await browserSession.launch();
  // Reject a port collision: a different Chrome already owns this port with another profile.
  const actual = await getUserDataDirOnDebugPort(debugPort);
  if (actual && !profilesMatch(profileRoot, actual)) {
    await browserSession.close().catch(() => {});
    throw new Error(
      `Isolated profile "${name}" expected Chrome on port ${debugPort} to use ${profileRoot}, but found ${actual}. Close that Chrome or pick another isolate name.`,
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
    if (!task.isolate) return Promise.resolve(input.browser);
    const existing = isolatedLanes.get(task.isolate);
    if (existing) return existing;
    // Memoize the launch promise so concurrent isolate tasks never double-spawn Chrome.
    const pending = launchIsolatedBrowser(task.isolate, input.config);
    isolatedLanes.set(task.isolate, pending);
    return pending;
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
    for (const pending of isolatedLanes.values()) {
      await pending.then((browserSession) => browserSession.close()).catch(() => {});
    }
  }
};
