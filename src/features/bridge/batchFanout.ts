import {
  BrowserManager,
  getUserDataDirOnDebugPort,
  profilesMatch,
  resolveIsolatedProfile,
} from "@/features/browser";
import type { BridgeConfig } from "@/features/domain";
import {
  chatGptConversationIdFromUrl,
  chatGptConversationUrlFromIdOrUrl,
  getBrowserProvider,
  normalizeProvider,
} from "@/features/providers";
import type { Page } from "playwright";
import type { FanoutTask } from "./bridgeSchemas.ts";
import type {
  FanoutBatchOptions,
  FanoutBatchResult,
  FanoutTarget,
  FanoutTaskReply,
} from "./fanoutOrchestrator.ts";
import { runFanoutTasks } from "./fanoutOrchestrator.ts";
import { Orchestrator } from "./internal/orchestrator.ts";

/** How long a freshly opened tab waits for the provider composer before asking. */
const COMPOSER_WAIT_MS = 30_000;

/** Resolve a task's `conversation` to a start URL, or undefined for a new Conversation. */
const resolveStartUrl = (task: FanoutTask, providerId: string): string | undefined => {
  if (!task.conversation) return undefined;
  // Only ChatGPT builds a thread URL from a bare id; other providers take a full URL as-is.
  return providerId === "chatgpt"
    ? chatGptConversationUrlFromIdOrUrl(task.conversation)
    : task.conversation;
};

/** Read back the Conversation a task landed on so the caller can reopen it later. */
const captureTarget = (page: Page, providerId: string, task: FanoutTask): FanoutTarget => {
  const url = page.url();
  return {
    provider: providerId,
    mode: task.conversation ? "existing" : "new",
    id: providerId === "chatgpt" ? chatGptConversationIdFromUrl(url) : null,
    url,
    isolate: task.isolate ?? null,
  };
};

/**
 * Drive one fan-out task on its own fresh tab, then close the tab.
 *
 * Opens a page in the given browser (a new Conversation, or an existing one when the task
 * carries a `conversation`), drives the turn through a per-task {@link Orchestrator} bound to
 * that page, captures the reply and Conversation target, and always closes the tab so peak
 * memory tracks the pool size, not the batch size.
 *
 * @param input - The lane browser, run config, the task, and optional manifest root / timeout.
 * @returns The captured reply plus the resolved Conversation target.
 * @example
 * ```ts
 * const reply = await runOneTaskOnTab({ browser, config, task: { prompt: "hi" } });
 * ```
 */
export const runOneTaskOnTab = async (input: {
  browser: BrowserManager;
  config: BridgeConfig;
  task: FanoutTask;
  manifestRoot?: string;
  timeoutMs?: number;
}): Promise<FanoutTaskReply> => {
  const providerId = normalizeProvider(input.task.provider ?? input.config.provider);
  const provider = getBrowserProvider(providerId);
  const startUrl = resolveStartUrl(input.task, providerId) ?? provider.defaultUrl;
  const page = await input.browser.openTab(startUrl);
  try {
    await page
      .waitForSelector(provider.composerSelector, { timeout: COMPOSER_WAIT_MS })
      .catch(() => {});
    await provider.assertSignedIn(page);
    const orchestrator = new Orchestrator(
      { ...input.config, provider: providerId },
      provider,
      input.manifestRoot ? { manifestRoot: input.manifestRoot } : {},
    );
    orchestrator.setPage(page);
    let orchestratorError: string | null = null;
    orchestrator.on((event) => {
      if (event.type === "error") orchestratorError = event.error;
    });
    const reply = await orchestrator.sendPrompt({
      content: input.task.prompt,
      ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
    });
    if (!reply) throw new Error(orchestratorError ?? `${provider.displayName}: no reply captured.`);
    return { reply: reply.content, target: captureTarget(page, providerId, input.task) };
  } finally {
    await page.close().catch(() => {});
  }
};

/** Launch (or reuse) a signed-in isolated-profile Chrome and verify it owns its profile. */
const launchIsolatedBrowser = async (
  name: string,
  config: BridgeConfig,
): Promise<BrowserManager> => {
  const { debugPort, profileRoot } = resolveIsolatedProfile(name);
  const manager = new BrowserManager(config.repoPath, normalizeProvider(config.provider), {
    prepareRepoState: false,
    debugPort,
    profileRoot,
  });
  await manager.launch();
  // Reject a port collision: a different Chrome already owns this port with another profile.
  const actual = await getUserDataDirOnDebugPort(debugPort);
  if (actual && !profilesMatch(profileRoot, actual)) {
    await manager.close().catch(() => {});
    throw new Error(
      `Isolated profile "${name}" expected Chrome on port ${debugPort} to use ${profileRoot}, but found ${actual}. Close that Chrome or pick another isolate name.`,
    );
  }
  return manager;
};

/**
 * Run a batch of fan-out tasks against the warm shared browser, opening one tab per task.
 *
 * Tasks without `isolate` share the passed-in browser (the one signed-in Chrome); tasks with
 * `isolate` are grouped by name onto a lazily launched second Chrome that is signed in once
 * and reused for the run, then disconnected. Scheduling, concurrency, truncation, and
 * pagination all come from {@link runFanoutTasks}; this layer only supplies the browser work.
 *
 * @param input - The shared browser, run config, ordered tasks, and batch options.
 * @returns The ordered, paginated fan-out result — one row per task in the window.
 * @example
 * ```ts
 * const result = await runFanoutBatch({
 *   browser: engine.browser,
 *   config: engine.config,
 *   tasks: [{ prompt: "one word: BLUE" }, { prompt: "one word: RED" }],
 *   options: { maxConcurrency: 2 },
 * });
 * ```
 */
export const runFanoutBatch = async (input: {
  browser: BrowserManager;
  config: BridgeConfig;
  tasks: readonly FanoutTask[];
  manifestRoot?: string;
  options?: FanoutBatchOptions;
}): Promise<FanoutBatchResult> => {
  const isolatedLanes = new Map<string, Promise<BrowserManager>>();
  const resolveLaneBrowser = (task: FanoutTask): Promise<BrowserManager> => {
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
      async (task) =>
        runOneTaskOnTab({
          browser: await resolveLaneBrowser(task),
          config: input.config,
          task,
          ...(input.manifestRoot ? { manifestRoot: input.manifestRoot } : {}),
          ...(input.options?.timeoutMs ? { timeoutMs: input.options.timeoutMs } : {}),
        }),
      input.options,
    );
  } finally {
    for (const pending of isolatedLanes.values()) {
      await pending.then((manager) => manager.close()).catch(() => {});
    }
  }
};
