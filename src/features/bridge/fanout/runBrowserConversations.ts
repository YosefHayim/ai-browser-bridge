import type { Page } from "playwright";
import { isolatedProfile } from "@/features/browser/browserProfile.ts";
import {
  BrowserSession,
  getUserDataDirOnDebugPort,
  profilesMatch,
} from "@/features/browser/browserSession.ts";
import {
  chatGptConversationIdFromUrl,
  chatGptConversationUrlFromIdOrUrl,
} from "@/features/webProviders/chatgpt/chatgptConversationUrl.ts";
import { providerIdFrom, webProviderFor } from "@/features/webProviders/providerRegistry.ts";
import { BrowserConversation } from "../conversation/BrowserConversation.ts";
import type { BridgeConfig } from "../engine/bridgeEngineTypes.ts";
import type { FanoutTask } from "../engine/bridgeSchemas.ts";
import type {
  FanoutOptions,
  FanoutResult,
  FanoutTarget,
  FanoutTaskReply,
} from "./runConversationTasks.ts";
import { runFanoutTasks } from "./runConversationTasks.ts";

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
 * carries a `conversation`), drives the turn through a per-task BrowserConversation bound to
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
  let taskProviderId = input.config.provider;
  if (input.task.provider !== undefined) taskProviderId = input.task.provider;
  const providerId = providerIdFrom(taskProviderId);
  // Fan-out closes each tab when its task ends, which would cancel a Design turn that
  // runs inside the tab.
  if (providerId === "design") {
    throw new Error(
      "Claude Design is not a Fan-out provider — use `bridge design send` or design_send.",
    );
  }
  const provider = webProviderFor(providerId);
  const conversationStartUrl = taskStartUrl(input.task, providerId);
  let startUrl = provider.defaultUrl;
  if (conversationStartUrl !== undefined) startUrl = conversationStartUrl;
  const page = await input.browser.openTab(startUrl);
  try {
    await Promise.allSettled([
      page.waitForSelector(provider.composerSelector, { timeout: COMPOSER_WAIT_MS }),
    ]);
    await provider.assertSignedIn(page);
    const conversationOptions: { manifestRoot?: string } = {};
    if (input.manifestRoot !== undefined) {
      conversationOptions.manifestRoot = input.manifestRoot;
    }
    const conversation = new BrowserConversation(
      { ...input.config, provider: providerId },
      provider,
      conversationOptions,
    );
    conversation.setPage(page);
    let conversationError: string | null = null;
    conversation.on((event) => {
      if (event.type === "error") conversationError = event.error;
    });
    const promptRequest: { content: string; timeoutMs?: number } = {
      content: input.task.prompt,
    };
    if (input.timeoutMs !== undefined) promptRequest.timeoutMs = input.timeoutMs;
    const assistantMessage = await conversation.sendPrompt(promptRequest);
    if (assistantMessage === null) {
      if (conversationError !== null) throw new Error(conversationError);
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
  const providerId = providerIdFrom(config.provider);
  const browserSession = new BrowserSession(providerId, {
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
  const isolatedBrowsersByName = new Map<string, Promise<BrowserSession>>();
  const browserForTask = (task: FanoutTask): Promise<BrowserSession> => {
    const isolateName = nonEmptyTaskField(task.isolate);
    if (isolateName === undefined) return Promise.resolve(input.browser);
    const existingBrowserLaunch = isolatedBrowsersByName.get(isolateName);
    if (existingBrowserLaunch !== undefined) return existingBrowserLaunch;
    // Memoize the launch promise so concurrent isolate tasks never double-spawn Chrome.
    const browserLaunch = launchIsolatedBrowser(isolateName, input.config);
    isolatedBrowsersByName.set(isolateName, browserLaunch);
    return browserLaunch;
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
    const browserClosures = [...isolatedBrowsersByName.values()].map((browserLaunch) =>
      browserLaunch.then((browserSession) => browserSession.close()),
    );
    await Promise.allSettled(browserClosures);
  }
};
