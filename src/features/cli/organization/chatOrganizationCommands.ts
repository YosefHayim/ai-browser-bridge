import { repositoryRoot } from "@/features/repoState/paths.ts";
import { acknowledgeChatGptHistoryRateLimit } from "@/features/webProviders/chatgpt/chatgptConversationSearch.ts";
import type { MoveChatOutcome } from "@/features/webProviders/chatgpt/chatgptWorkspace.ts";
import { moveChatToProject } from "@/features/webProviders/chatgpt/chatgptWorkspace.ts";
import { requireChatgptProvider, startChatgptSession } from "../browser/browserConnection.ts";
import type { ChatOrganizationOptions } from "../presentation/cliTypes.ts";
import { exitWithCliError } from "../presentation/commandOutput.ts";
import {
  acquireChatOrganizationQueueLock,
  adaptiveChatOrganizationPacingAfterRateLimit,
  adaptiveChatOrganizationPacingAfterSuccess,
  type ChatOrganizationInterval,
  type ChatOrganizationPacing,
  type ChatOrganizationQueue,
  chatOrganizationIntervalFrom,
  chatOrganizationIntervalLabel,
  chatOrganizationQueueIsPaused,
  chatOrganizationQueuePath,
  chatOrganizationSessionWasClosed,
  chatOrganizationVerificationFrom,
  clearChatOrganizationQueuePause,
  completeChatOrganizationQueueItem,
  constrainChatOrganizationPacing,
  deferChatOrganizationQueueItem,
  failChatOrganizationQueueItem,
  initialChatOrganizationPacing,
  loadChatOrganizationTasks,
  nextAdaptiveChatOrganizationIntervalSeconds,
  nextChatOrganizationIntervalSeconds,
  nextChatOrganizationQueueIndex,
  openChatOrganizationQueue,
  pauseChatOrganizationQueue,
  persistChatOrganizationQueue,
  reopenChatOrganizationQueueItems,
  resolveChatOrganizationQueue,
  summarizeChatOrganizationQueue,
  updateChatOrganizationQueuePacing,
  updateChatOrganizationQueueVerification,
} from "./chatOrganizationQueue.ts";

const DEFAULT_ORGANIZATION_INTERVAL_SECONDS = 60;

const DEFAULT_ORGANIZATION_MIN_INTERVAL_SECONDS = 15;

const DEFAULT_ORGANIZATION_MAX_INTERVAL_SECONDS = 180;

const DEFAULT_ORGANIZATION_SPEED_UP_AFTER = 3;

const DEFAULT_ORGANIZATION_COOLDOWN_SECONDS = 600;

const DEFAULT_ORGANIZATION_MAX_ATTEMPTS = 4;

const MAX_CONSECUTIVE_ORGANIZATION_COOLDOWNS = 12;

const RATE_LIMIT_REASON = "ChatGPT temporarily limited access to Conversation history.";

const CLOSED_SESSION_REASON = "ChatGPT browser session closed; reopening before retry.";

const positiveIntegerOption = (
  value: string | undefined,
  optionName: string,
  defaultValue: number,
): number => {
  if (value === undefined) return defaultValue;
  if (!/^[1-9]\d*$/u.test(value.trim())) {
    return exitWithCliError(`${optionName} must be a positive whole number.`);
  }
  const parsed = Number.parseInt(value, 10);
  return parsed;
};

const organizationIntervalOption = (value: string | undefined): ChatOrganizationInterval => {
  try {
    return chatOrganizationIntervalFrom(value, DEFAULT_ORGANIZATION_INTERVAL_SECONDS);
  } catch (error) {
    return exitWithCliError(error instanceof Error ? error.message : String(error));
  }
};

const waitForOrganizationInterval = async (
  seconds: number,
  queuePath: string,
): Promise<"elapsed" | "paused"> => {
  let remainingMilliseconds = seconds * 1_000;
  while (remainingMilliseconds > 0) {
    if (await chatOrganizationQueueIsPaused(queuePath)) return "paused";
    const slice = Math.min(1_000, remainingMilliseconds);
    await new Promise<void>((complete) => setTimeout(complete, slice));
    remainingMilliseconds -= slice;
  }
  if (await chatOrganizationQueueIsPaused(queuePath)) return "paused";
  return "elapsed";
};

const writeChatOrganizationProgress = (message: string, options: ChatOrganizationOptions): void => {
  if (options.json) {
    process.stderr.write(`${message}\n`);
    return;
  }
  process.stdout.write(`${message}\n`);
};

const moveFailureReason = (outcome: MoveChatOutcome): string => {
  if (outcome.reason?.trim()) return outcome.reason;
  return "ChatGPT did not confirm the Conversation move.";
};

const writeChatOrganizationSummary = (input: {
  queuePath: string;
  queue: ChatOrganizationQueue;
  options: ChatOrganizationOptions;
  paused?: boolean;
}): void => {
  const summary = summarizeChatOrganizationQueue(input.queue);
  if (input.options.json) {
    process.stdout.write(
      `${JSON.stringify({
        queuePath: input.queuePath,
        state: input.paused ? "paused" : "finished",
        summary,
        pacing: input.queue.pacing,
        verification: input.queue.verification,
      })}\n`,
    );
    return;
  }
  process.stdout.write(
    `${[
      input.paused ? "Organization queue paused." : "Organization queue finished.",
      `Moved: ${summary.moved}`,
      `Already filed: ${summary.alreadyFiled}`,
      `Pending: ${summary.pending}`,
      `Failed: ${summary.failed}`,
      input.queue.pacing === undefined
        ? undefined
        : `Adaptive pace: ${input.queue.pacing.currentSeconds}s base (${input.queue.pacing.rateLimitCount} rate limits)`,
      input.queue.verification === undefined
        ? undefined
        : `Full-history verification: ${input.queue.verification.complete ? "complete" : "incomplete"}; ${input.queue.verification.remainingOrphans} intentional/remaining orphans`,
      `Queue state: ${input.queuePath}`,
    ]
      .filter((line) => line !== undefined)
      .join("\n")}\n`,
  );
};

const writeChatOrganizationDryRun = (input: {
  tasks: Awaited<ReturnType<typeof loadChatOrganizationTasks>>;
  queuePath: string;
  interval: ChatOrganizationInterval;
  cooldownSeconds: number;
  maxAttempts: number;
  adaptive: boolean;
  minimumIntervalSeconds: number;
  maximumIntervalSeconds: number;
  speedUpAfter: number;
  options: ChatOrganizationOptions;
}): void => {
  const preview = {
    dryRun: true,
    queuePath: input.queuePath,
    interval: input.interval,
    cooldownSeconds: input.cooldownSeconds,
    maxAttempts: input.maxAttempts,
    adaptive: input.adaptive,
    minimumIntervalSeconds: input.minimumIntervalSeconds,
    maximumIntervalSeconds: input.maximumIntervalSeconds,
    speedUpAfter: input.speedUpAfter,
    tasks: input.tasks,
  };
  if (input.options.json) {
    process.stdout.write(`${JSON.stringify(preview)}\n`);
    return;
  }
  process.stdout.write(
    `${[
      `Organization queue dry run: ${input.tasks.length} Conversations`,
      `Interval: ${chatOrganizationIntervalLabel(input.interval)}`,
      `Adaptive pacing: ${input.adaptive ? `yes (${input.minimumIntervalSeconds}-${input.maximumIntervalSeconds}s; speed up after ${input.speedUpAfter} successes)` : "no"}`,
      `Rate-limit cooldown: ${input.cooldownSeconds}s`,
      `Attempts per Conversation: ${input.maxAttempts}`,
      `Resume state: ${input.queuePath}`,
      ...input.tasks.map((task) => `  ${task.conversation} -> ${task.project}`),
    ].join("\n")}\n`,
  );
};

const recordChatOrganizationAttempt = async (input: {
  queue: ChatOrganizationQueue;
  queuePath: string;
  index: number;
  maxAttempts: number;
  sessionClosed: boolean;
  rateLimited: boolean;
  moveOutcome?: MoveChatOutcome;
  thrownReason?: string;
}): Promise<ChatOrganizationQueue> => {
  const timestamp = new Date().toISOString();
  let queue: ChatOrganizationQueue;
  if (input.sessionClosed) {
    queue = deferChatOrganizationQueueItem({
      queue: input.queue,
      index: input.index,
      reason: CLOSED_SESSION_REASON,
      timestamp,
    });
  } else if (input.rateLimited) {
    queue = deferChatOrganizationQueueItem({
      queue: input.queue,
      index: input.index,
      reason: RATE_LIMIT_REASON,
      timestamp,
    });
  } else if (input.moveOutcome?.moved) {
    queue = completeChatOrganizationQueueItem({
      queue: input.queue,
      index: input.index,
      status: "moved",
      timestamp,
    });
  } else if (input.moveOutcome?.alreadyFiled) {
    queue = completeChatOrganizationQueueItem({
      queue: input.queue,
      index: input.index,
      status: "already-filed",
      timestamp,
    });
  } else {
    let reason = "ChatGPT did not complete the Conversation move.";
    if (input.moveOutcome !== undefined) reason = moveFailureReason(input.moveOutcome);
    else if (input.thrownReason !== undefined) reason = input.thrownReason;
    queue = failChatOrganizationQueueItem({
      queue: input.queue,
      index: input.index,
      reason,
      maxAttempts: input.maxAttempts,
      timestamp,
    });
  }
  await persistChatOrganizationQueue(input.queuePath, queue);
  return queue;
};

const persistChatOrganizationPacing = async (input: {
  queue: ChatOrganizationQueue;
  queuePath: string;
  pacing: ChatOrganizationPacing;
}): Promise<ChatOrganizationQueue> => {
  const queue = updateChatOrganizationQueuePacing({
    queue: input.queue,
    pacing: input.pacing,
    timestamp: new Date().toISOString(),
  });
  await persistChatOrganizationQueue(input.queuePath, queue);
  return queue;
};

const verifyCompletedChatOrganizationQueue = async (input: {
  queue: ChatOrganizationQueue;
  queuePath: string;
  workspace: Awaited<ReturnType<typeof startChatgptSession>>;
  options: ChatOrganizationOptions;
  maxAttempts: number;
}): Promise<ChatOrganizationQueue> => {
  writeChatOrganizationProgress(
    "Verifying the completed plan against an exhaustive full-history orphan scan.",
    input.options,
  );
  const timestamp = new Date().toISOString();
  let verification: NonNullable<ChatOrganizationQueue["verification"]>;
  try {
    const orphans = await input.workspace.engine
      .getBrowserConversation()
      .listConversations({ orphans: true });
    verification = chatOrganizationVerificationFrom({
      queue: input.queue,
      orphans,
      timestamp,
    });
  } catch (error) {
    verification = {
      complete: false,
      inventoryComplete: false,
      remainingOrphans: 0,
      plannedStillLoose: [],
      verifiedAt: timestamp,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  let queue = updateChatOrganizationQueueVerification({
    queue: input.queue,
    verification,
    timestamp,
  });
  if (verification.plannedStillLoose.length > 0) {
    queue = reopenChatOrganizationQueueItems({
      queue,
      conversations: verification.plannedStillLoose,
      maxAttempts: input.maxAttempts,
      timestamp,
    });
  }
  await persistChatOrganizationQueue(input.queuePath, queue);
  if (verification.inventoryComplete) {
    writeChatOrganizationProgress(
      `Full-history scan reached the stable end: ${verification.remainingOrphans} loose Conversations remain; ${verification.plannedStillLoose.length} planned Conversations are still loose.`,
      input.options,
    );
  } else {
    let scanFailure = verification.error;
    if (scanFailure === undefined || scanFailure === null) scanFailure = "unknown scan failure";
    writeChatOrganizationProgress(
      `Full-history verification could not prove completion: ${scanFailure}`,
      input.options,
    );
  }
  return queue;
};

const organizationQueueState = (input: {
  paused: boolean;
  running: boolean;
  summary: ReturnType<typeof summarizeChatOrganizationQueue>;
}): "running" | "pausing" | "paused" | "idle" | "completed" | "failed" => {
  if (input.running) return input.paused ? "pausing" : "running";
  if (input.paused) return "paused";
  if (input.summary.pending === 0) return input.summary.failed > 0 ? "failed" : "completed";
  return "idle";
};

export const runChatOrganizeStatus = async (options: ChatOrganizationOptions): Promise<void> => {
  const selected = await resolveChatOrganizationQueue(repositoryRoot(options.repo), options.queue);
  const summary = summarizeChatOrganizationQueue(selected.queue);
  const state = organizationQueueState({
    paused: selected.paused,
    running: selected.running,
    summary,
  });
  const status = {
    state,
    queuePath: selected.path,
    ownerPid: selected.ownerPid,
    summary,
    pacing: selected.queue.pacing,
    verification: selected.queue.verification,
  };
  if (options.json) process.stdout.write(`${JSON.stringify(status)}\n`);
  else {
    process.stdout.write(
      `${[
        `Organization queue: ${state}`,
        `Moved: ${summary.moved}`,
        `Already filed: ${summary.alreadyFiled}`,
        `Pending: ${summary.pending}`,
        `Failed: ${summary.failed}`,
        selected.queue.pacing === undefined
          ? "Adaptive pace: not initialized"
          : `Adaptive pace: ${selected.queue.pacing.currentSeconds}s base (${selected.queue.pacing.successStreak} success streak; ${selected.queue.pacing.rateLimitCount} rate limits)`,
        selected.queue.verification === undefined
          ? "Full-history verification: not run"
          : `Full-history verification: ${selected.queue.verification.complete ? "complete" : "incomplete"}`,
        `Queue state: ${selected.path}`,
      ].join("\n")}\n`,
    );
  }
};

export const runChatOrganizePause = async (options: ChatOrganizationOptions): Promise<void> => {
  const selected = await resolveChatOrganizationQueue(repositoryRoot(options.repo), options.queue);
  await pauseChatOrganizationQueue(selected.path, new Date().toISOString());
  const message = selected.running
    ? "Pause requested; the active UI operation will finish before the queue releases its lock."
    : "Organization queue paused.";
  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ state: selected.running ? "pausing" : "paused", queuePath: selected.path })}\n`,
    );
  } else process.stdout.write(`${message}\nQueue state: ${selected.path}\n`);
};

export const runChatOrganizeResume = async (options: ChatOrganizationOptions): Promise<void> => {
  requireChatgptProvider(options);
  const selected = await resolveChatOrganizationQueue(repositoryRoot(options.repo), options.queue);
  if (selected.running)
    return exitWithCliError(`Organization queue is already running: ${selected.path}`);
  await clearChatOrganizationQueuePause(selected.path);
  const plan = JSON.stringify(
    selected.queue.items.map((item) => ({
      conversation: item.conversation,
      project: item.project,
    })),
  );
  return runChatOrganize({ ...options, plan, restart: false, dryRun: false });
};

export const runChatOrganize = async (options: ChatOrganizationOptions): Promise<void> => {
  requireChatgptProvider(options);
  const plan = options.plan;
  if (plan === undefined || !plan.trim()) {
    return exitWithCliError("Usage: bridge chat organize --plan <fileOrJson>");
  }
  const interval = organizationIntervalOption(options.interval);
  const adaptive = options.adaptive !== false;
  const minimumIntervalSeconds = positiveIntegerOption(
    options.minInterval,
    "--min-interval",
    DEFAULT_ORGANIZATION_MIN_INTERVAL_SECONDS,
  );
  const maximumIntervalSeconds = positiveIntegerOption(
    options.maxInterval,
    "--max-interval",
    DEFAULT_ORGANIZATION_MAX_INTERVAL_SECONDS,
  );
  if (maximumIntervalSeconds < minimumIntervalSeconds) {
    return exitWithCliError("--max-interval must be greater than or equal to --min-interval.");
  }
  const speedUpAfter = positiveIntegerOption(
    options.speedUpAfter,
    "--speed-up-after",
    DEFAULT_ORGANIZATION_SPEED_UP_AFTER,
  );
  const cooldownSeconds = positiveIntegerOption(
    options.cooldown,
    "--cooldown",
    DEFAULT_ORGANIZATION_COOLDOWN_SECONDS,
  );
  const maxAttempts = positiveIntegerOption(
    options.maxAttempts,
    "--max-attempts",
    DEFAULT_ORGANIZATION_MAX_ATTEMPTS,
  );
  let tasks: Awaited<ReturnType<typeof loadChatOrganizationTasks>>;
  try {
    tasks = await loadChatOrganizationTasks(plan, process.cwd());
  } catch (error) {
    return exitWithCliError(error instanceof Error ? error.message : String(error));
  }
  const repoRoot = repositoryRoot(options.repo);
  const queuePath = chatOrganizationQueuePath(repoRoot, tasks);
  if (options.dryRun) {
    writeChatOrganizationDryRun({
      tasks,
      queuePath,
      interval,
      cooldownSeconds,
      maxAttempts,
      adaptive,
      minimumIntervalSeconds,
      maximumIntervalSeconds,
      speedUpAfter,
      options,
    });
    process.exit(0);
  }
  let releaseQueueLock: () => Promise<void>;
  try {
    releaseQueueLock = await acquireChatOrganizationQueueLock(queuePath);
  } catch (error) {
    return exitWithCliError(error instanceof Error ? error.message : String(error));
  }
  let queue: ChatOrganizationQueue;
  try {
    const opened = await openChatOrganizationQueue({
      repoRoot,
      tasks,
      restart: Boolean(options.restart),
      timestamp: new Date().toISOString(),
    });
    queue = opened.queue;
    if (adaptive) {
      const pacing =
        queue.pacing === undefined
          ? initialChatOrganizationPacing(
              Math.min(
                maximumIntervalSeconds,
                Math.max(
                  minimumIntervalSeconds,
                  nextChatOrganizationIntervalSeconds(interval, Math.random()),
                ),
              ),
            )
          : constrainChatOrganizationPacing(queue.pacing, {
              minimumSeconds: minimumIntervalSeconds,
              maximumSeconds: maximumIntervalSeconds,
              speedUpAfter,
            });
      queue = await persistChatOrganizationPacing({
        queue,
        queuePath,
        pacing,
      });
    }
  } catch (error) {
    await releaseQueueLock();
    return exitWithCliError(
      `Could not open the organization queue: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const initialSummary = summarizeChatOrganizationQueue(queue);
  writeChatOrganizationProgress(
    `Organization queue: ${initialSummary.pending} pending of ${initialSummary.total}; state ${queuePath}`,
    options,
  );
  const needsVerification = options.verify !== false && queue.verification?.complete !== true;
  if (initialSummary.pending === 0 && !needsVerification) {
    writeChatOrganizationSummary({ queuePath, queue, options });
    await releaseQueueLock();
    process.exit(
      initialSummary.failed === 0 &&
        (options.verify === false || queue.verification?.complete === true)
        ? 0
        : 1,
    );
  }
  let workspace: Awaited<ReturnType<typeof startChatgptSession>>;
  try {
    workspace = await startChatgptSession(options);
  } catch (error) {
    await releaseQueueLock();
    throw error;
  }
  let workspaceWasShutdown = false;
  let paused = false;
  try {
    let consecutiveRateLimitCooldowns = 0;
    let halted = false;
    while (!paused && !halted) {
      let index = nextChatOrganizationQueueIndex(queue);
      while (index !== undefined) {
        if (await chatOrganizationQueueIsPaused(queuePath)) {
          paused = true;
          writeChatOrganizationProgress(
            "Organization queue pause acknowledged; no new UI operation will start.",
            options,
          );
          break;
        }
        const item = queue.items[index];
        if (item === undefined || item.status !== "pending") {
          index = nextChatOrganizationQueueIndex(queue);
          continue;
        }
        if (await acknowledgeChatGptHistoryRateLimit(workspace.page)) {
          consecutiveRateLimitCooldowns += 1;
          if (adaptive && queue.pacing !== undefined) {
            queue = await persistChatOrganizationPacing({
              queue,
              queuePath,
              pacing: adaptiveChatOrganizationPacingAfterRateLimit(queue.pacing, {
                maximumSeconds: maximumIntervalSeconds,
              }),
            });
          }
          if (consecutiveRateLimitCooldowns >= MAX_CONSECUTIVE_ORGANIZATION_COOLDOWNS) {
            writeChatOrganizationProgress(
              `ChatGPT remained rate-limited after ${consecutiveRateLimitCooldowns} cooldowns; leaving the queue pending for a later resume.`,
              options,
            );
            halted = true;
            break;
          }
          writeChatOrganizationProgress(
            `ChatGPT rate limit detected; cooling down for ${cooldownSeconds}s before continuing${queue.pacing === undefined ? "." : ` at a slower ${queue.pacing.currentSeconds}s adaptive pace.`}`,
            options,
          );
          if ((await waitForOrganizationInterval(cooldownSeconds, queuePath)) === "paused") {
            paused = true;
            break;
          }
          continue;
        }
        consecutiveRateLimitCooldowns = 0;
        writeChatOrganizationProgress(
          `Moving "${item.conversation}" -> ${item.project} (attempt ${item.attempts + 1}/${maxAttempts})`,
          options,
        );
        let moveOutcome: MoveChatOutcome | undefined;
        let thrownReason: string | undefined;
        try {
          moveOutcome = await moveChatToProject(workspace.page, {
            chat: item.conversation,
            project: item.project,
          });
        } catch (error) {
          thrownReason = error instanceof Error ? error.message : String(error);
        }
        const sessionClosed = chatOrganizationSessionWasClosed(thrownReason);
        const rateLimited = await acknowledgeChatGptHistoryRateLimit(workspace.page);
        queue = await recordChatOrganizationAttempt({
          queue,
          queuePath,
          index,
          maxAttempts,
          sessionClosed,
          rateLimited,
          moveOutcome,
          thrownReason,
        });
        if (adaptive && queue.pacing !== undefined) {
          let pacing = queue.pacing;
          if (rateLimited) {
            pacing = adaptiveChatOrganizationPacingAfterRateLimit(pacing, {
              maximumSeconds: maximumIntervalSeconds,
            });
          } else if (moveOutcome?.moved || moveOutcome?.alreadyFiled) {
            pacing = adaptiveChatOrganizationPacingAfterSuccess(pacing, {
              minimumSeconds: minimumIntervalSeconds,
              speedUpAfter,
            });
          } else if (pacing.successStreak > 0) {
            pacing = { ...pacing, successStreak: 0 };
          }
          queue = await persistChatOrganizationPacing({ queue, queuePath, pacing });
        }
        if (sessionClosed) {
          writeChatOrganizationProgress(
            "ChatGPT browser session closed; reopening it without consuming a retry attempt.",
            options,
          );
          await workspace.engine.shutdown({ closeBrowser: false });
          workspaceWasShutdown = true;
          try {
            workspace = await startChatgptSession(options);
            workspaceWasShutdown = false;
          } catch (error) {
            writeChatOrganizationProgress(
              `Could not reopen the ChatGPT browser session; leaving the queue pending: ${
                error instanceof Error ? error.message : String(error)
              }`,
              options,
            );
            halted = true;
            break;
          }
          index = nextChatOrganizationQueueIndex(queue);
          continue;
        }
        const recorded = queue.items[index];
        if (recorded?.status === "moved") {
          writeChatOrganizationProgress(`Moved "${recorded.conversation}".`, options);
        } else if (recorded?.status === "already-filed") {
          writeChatOrganizationProgress(`Already filed "${recorded.conversation}".`, options);
        } else if (recorded?.status === "failed") {
          writeChatOrganizationProgress(
            `Failed "${recorded.conversation}" after ${recorded.attempts} attempts: ${recorded.reason}`,
            options,
          );
        } else if (recorded?.status === "pending") {
          let reason = "unknown failure";
          if (recorded.lastReason !== undefined) reason = recorded.lastReason;
          writeChatOrganizationProgress(
            `Will retry "${recorded.conversation}": ${reason}`,
            options,
          );
        }
        let waitSeconds =
          adaptive && queue.pacing !== undefined
            ? nextAdaptiveChatOrganizationIntervalSeconds(queue.pacing, Math.random())
            : nextChatOrganizationIntervalSeconds(interval, Math.random());
        if (rateLimited) {
          consecutiveRateLimitCooldowns += 1;
          waitSeconds = cooldownSeconds;
        }
        index = nextChatOrganizationQueueIndex(queue);
        if (index !== undefined) {
          writeChatOrganizationProgress(
            `Waiting ${waitSeconds}s before the next UI operation${adaptive ? " (adaptive)." : "."}`,
            options,
          );
          if ((await waitForOrganizationInterval(waitSeconds, queuePath)) === "paused") {
            paused = true;
            break;
          }
        }
      }
      if (paused || halted) break;
      if (options.verify !== false && summarizeChatOrganizationQueue(queue).pending === 0) {
        queue = await verifyCompletedChatOrganizationQueue({
          queue,
          queuePath,
          workspace,
          options,
          maxAttempts,
        });
      }
      const reopened = nextChatOrganizationQueueIndex(queue);
      if (reopened === undefined) break;
      writeChatOrganizationProgress(
        "The full-history audit found planned Conversations still loose; retrying them automatically.",
        options,
      );
      consecutiveRateLimitCooldowns = 0;
    }
  } finally {
    try {
      if (!workspaceWasShutdown) await workspace.engine.shutdown({ closeBrowser: false });
    } finally {
      await releaseQueueLock();
    }
  }
  const summary = summarizeChatOrganizationQueue(queue);
  writeChatOrganizationSummary({ queuePath, queue, options, paused });
  if (paused) process.exit(0);
  let exitCode = 0;
  if (
    summary.failed > 0 ||
    summary.pending > 0 ||
    (options.verify !== false && queue.verification?.complete !== true)
  ) {
    exitCode = 1;
  }
  process.exit(exitCode);
};
