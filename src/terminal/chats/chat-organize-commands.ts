import { dismissChatGptHistoryRateLimit } from "@/providers/chatgpt/chatgpt-conversation-search.ts";
import { readProjectIdNamed } from "@/providers/chatgpt/chatgpt-project-lookup.ts";
import { readProjectIds } from "@/providers/chatgpt/chatgpt-projects-api.ts";
import { type MoveChatVerdict, moveChatToProject } from "@/providers/chatgpt/chatgpt-workspace.ts";
import { readRepositoryRoot } from "@/store/paths.ts";
import {
  acquireChatOrganizationQueueLock,
  type ChatOrganizationInterval,
  type ChatOrganizationPacing,
  type ChatOrganizationQueue,
  clampChatOrganizationPacing,
  clearChatOrganizationQueuePause,
  completeChatOrganizationQueueElement,
  createInitialChatOrganizationPacing,
  deferChatOrganizationQueueElement,
  failChatOrganizationQueueElement,
  findChatOrganizationQueue,
  findNextChatOrganizationQueueIndex,
  isChatOrganizationQueuePaused,
  isChatOrganizationSessionClosed,
  loadChatOrganizationTasks,
  openChatOrganizationQueue,
  pauseChatOrganizationQueue,
  persistChatOrganizationQueue,
  pickNextAdaptiveChatOrganizationIntervalSeconds,
  pickNextChatOrganizationIntervalSeconds,
  readChatOrganizationInterval,
  readChatOrganizationQueuePath,
  reopenChatOrganizationQueueElements,
  slowDownPacingAfterRateLimit,
  speedUpPacingAfterSuccess,
  summarizeChatOrganizationQueue,
  updateChatOrganizationQueuePacing,
  updateChatOrganizationQueueVerification,
  verifyChatOrganizationQueue,
} from "@/terminal/chat-organization-queue.ts";
import { fail, failUsage, readCliFailureMessage } from "@/terminal/cli-failure.ts";
import { NEWLINE } from "@/terminal/cli-text.ts";
import type { ChatOrganizationSettings } from "@/terminal/cli-types.ts";
import { assertChatgptWorkspace, startWorkspaceSession } from "@/terminal/engine-session.ts";
import {
  QUEUE_PAUSED_MESSAGE,
  writeChatOrganizationDryRun,
  writeChatOrganizationProgress,
  writeChatOrganizationSummary,
} from "./chat-organize-reports.ts";

const SENTENCE_END = ".";

const PAUSING_STATUS = "pausing";

const PAUSED_STATUS = "paused";

const MILLISECONDS_PER_SECOND = 1_000;

const PENDING_STATUS = "pending";

const MOVED_STATUS = "moved";

const FAILED_STATUS = "failed";

const ALREADY_FILED_STATUS = "already-filed";

const DEFAULT_ORGANIZATION_INTERVAL_SECONDS = 60;

const DEFAULT_ORGANIZATION_MIN_INTERVAL_SECONDS = 15;

const DEFAULT_ORGANIZATION_MAX_INTERVAL_SECONDS = 180;

const DEFAULT_ORGANIZATION_SPEED_UP_AFTER = 3;

const DEFAULT_ORGANIZATION_COOLDOWN_SECONDS = 600;

const DEFAULT_ORGANIZATION_MAX_ATTEMPTS = 4;

const MAX_CONSECUTIVE_ORGANIZATION_COOLDOWNS = 12;

const readPositiveIntegerOption = (
  flagArgument: string | undefined,
  optionName: string,
  defaultField: number,
): number => {
  const isFlagArgumentUnset = flagArgument == null;
  if (isFlagArgumentUnset) return defaultField;

  const isNotPositiveInteger = !/^[1-9]\d*$/u.test(flagArgument.trim());
  if (isNotPositiveInteger) {
    return failUsage(`${optionName} must be a positive whole number.`);
  }

  const decimalRadix = 10;

  const parsed = Number.parseInt(flagArgument, decimalRadix);
  return parsed;
};

const readOrganizationIntervalOption = (field: string | undefined): ChatOrganizationInterval => {
  try {
    return readChatOrganizationInterval(field, DEFAULT_ORGANIZATION_INTERVAL_SECONDS);
  } catch (error) {
    return fail(readCliFailureMessage(error));
  }
};

const waitForOrganizationInterval = async (
  seconds: number,
  queuePath: string,
): Promise<"elapsed" | "paused"> => {
  let remainingMilliseconds = seconds * MILLISECONDS_PER_SECOND;
  while (remainingMilliseconds > 0) {
    const isQueuePaused = await isChatOrganizationQueuePaused(queuePath);
    if (isQueuePaused) return PAUSED_STATUS;

    const slice = Math.min(MILLISECONDS_PER_SECOND, remainingMilliseconds);
    await new Promise<void>((complete) => setTimeout(complete, slice));
    remainingMilliseconds -= slice;
  }

  const isQueuePausedNow = await isChatOrganizationQueuePaused(queuePath);
  if (isQueuePausedNow) return PAUSED_STATUS;

  return "elapsed";
};

const moveFailureReason = (verdict: MoveChatVerdict): string => {
  const reason = verdict.reason;
  const isReasonGiven = reason != null && reason.trim() !== "";
  if (isReasonGiven) return reason;

  return "ChatGPT did not confirm the Conversation move.";
};

const saveChatOrganizationAttempt = async (details: {
  queue: ChatOrganizationQueue;
  queuePath: string;
  index: number;
  maxAttempts: number;
  sessionClosed: boolean;
  rateLimited: boolean;
  moveOutcome?: MoveChatVerdict;
  thrownReason?: string;
}): Promise<ChatOrganizationQueue> => {
  const timestamp = new Date().toISOString();
  let queue: ChatOrganizationQueue;

  const isSessionClosed = details.sessionClosed;
  const isQueueRateLimited = details.rateLimited;
  const isMoveSuccessful = details.moveOutcome?.moved === true;
  const isMoveAlreadyFiled = details.moveOutcome?.alreadyFiled === true;
  if (isSessionClosed) {
    queue = deferChatOrganizationQueueElement({
      queue: details.queue,
      index: details.index,
      reason: "ChatGPT browser session closed; reopening before retry.",
      timestamp,
    });
  } else if (isQueueRateLimited) {
    queue = deferChatOrganizationQueueElement({
      queue: details.queue,
      index: details.index,
      reason: "ChatGPT temporarily limited access to Conversation history.",
      timestamp,
    });
  } else if (isMoveSuccessful) {
    queue = completeChatOrganizationQueueElement({
      queue: details.queue,
      index: details.index,
      status: MOVED_STATUS,
      timestamp,
    });
  } else if (isMoveAlreadyFiled) {
    queue = completeChatOrganizationQueueElement({
      queue: details.queue,
      index: details.index,
      status: ALREADY_FILED_STATUS,
      timestamp,
    });
  } else {
    let reason = "ChatGPT did not complete the Conversation move.";

    const moveVerdict = details.moveOutcome;
    const thrownReason = details.thrownReason;
    const isMoveVerdictGiven = moveVerdict != null;
    const isThrownReasonGiven = thrownReason != null;

    if (isMoveVerdictGiven) reason = moveFailureReason(moveVerdict);
    else if (isThrownReasonGiven) reason = thrownReason;

    queue = failChatOrganizationQueueElement({
      queue: details.queue,
      index: details.index,
      reason,
      maxAttempts: details.maxAttempts,
      timestamp,
    });
  }

  await persistChatOrganizationQueue(details.queuePath, queue);
  return queue;
};

const persistChatOrganizationPacing = async (details: {
  queue: ChatOrganizationQueue;
  queuePath: string;
  pacing: ChatOrganizationPacing;
}): Promise<ChatOrganizationQueue> => {
  const queue = updateChatOrganizationQueuePacing({
    queue: details.queue,
    pacing: details.pacing,
    timestamp: new Date().toISOString(),
  });

  await persistChatOrganizationQueue(details.queuePath, queue);

  return queue;
};

const verifyCompletedChatOrganizationQueue = async (details: {
  queue: ChatOrganizationQueue;
  queuePath: string;
  workspace: Awaited<ReturnType<typeof startWorkspaceSession>>;
  options: ChatOrganizationSettings;
  maxAttempts: number;
}): Promise<ChatOrganizationQueue> => {
  writeChatOrganizationProgress(
    "Verifying the completed plan against an exhaustive full-history orphan scan.",
    details.options,
  );
  const timestamp = new Date().toISOString();
  let verification: NonNullable<ChatOrganizationQueue["verification"]>;
  try {
    const orphans = await details.workspace.engine
      .getOrchestrator()
      .listConversations({ orphans: true });
    verification = verifyChatOrganizationQueue({
      queue: details.queue,
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
      error: readCliFailureMessage(error),
    };
  }
  let queue = updateChatOrganizationQueueVerification({
    queue: details.queue,
    verification,
    timestamp,
  });

  const hasVerificationPlannedStillLoose = verification.plannedStillLoose.length > 0;
  if (hasVerificationPlannedStillLoose) {
    queue = reopenChatOrganizationQueueElements({
      queue,
      conversations: verification.plannedStillLoose,
      maxAttempts: details.maxAttempts,
      timestamp,
    });
  }

  await persistChatOrganizationQueue(details.queuePath, queue);

  const isInventoryComplete = verification.inventoryComplete;
  if (isInventoryComplete) {
    writeChatOrganizationProgress(
      `Full-history scan reached the stable end: ${verification.remainingOrphans} loose Conversations remain; ${verification.plannedStillLoose.length} planned Conversations are still loose.`,
      details.options,
    );
  } else {
    writeChatOrganizationProgress(
      `Full-history verification could not prove completion: ${verification.error ?? "unknown scan failure"}`,
      details.options,
    );
  }

  return queue;
};

const readOrganizationQueueStatus = (details: {
  paused: boolean;
  running: boolean;
  summary: ReturnType<typeof summarizeChatOrganizationQueue>;
}): "running" | "pausing" | "paused" | "idle" | "completed" | "failed" => {
  const isRunning = details.running;
  const isPaused = details.paused;
  if (isRunning) return isPaused ? PAUSING_STATUS : "running";

  if (isPaused) return PAUSED_STATUS;

  const isNothingPending = details.summary.pending === 0;
  const hasFailedElements = details.summary.failed > 0;

  if (isNothingPending) return hasFailedElements ? FAILED_STATUS : "completed";

  return "idle";
};

export const runChatOrganizeStatus = async (settings: ChatOrganizationSettings): Promise<void> => {
  const selected = await findChatOrganizationQueue(
    readRepositoryRoot(settings.repo),
    settings.queue,
  );
  const summary = summarizeChatOrganizationQueue(selected.queue);
  const queueStatus = readOrganizationQueueStatus({
    paused: selected.paused,
    running: selected.running,
    summary,
  });
  const status = {
    state: queueStatus,
    queuePath: selected.path,
    ownerPid: selected.ownerPid,
    summary,
    pacing: selected.queue.pacing,
    verification: selected.queue.verification,
  };

  const isMachineReadable = settings.json;
  if (isMachineReadable) process.stdout.write(`${JSON.stringify(status)}\n`);
  else {
    const selectedPacing = selected.queue.pacing;
    const selectedVerification = selected.queue.verification;
    const isQueuePacingMissing = selectedPacing == null;
    const isQueueVerificationMissing = selectedVerification == null;
    process.stdout.write(
      `${[
        `Organization queue: ${queueStatus}`,
        `Moved: ${summary.moved}`,
        `Already filed: ${summary.alreadyFiled}`,
        `Pending: ${summary.pending}`,
        `Failed: ${summary.failed}`,
        isQueuePacingMissing
          ? "Adaptive pace: not initialized"
          : `Adaptive pace: ${selectedPacing.currentSeconds}s base (${selectedPacing.successStreak} success streak; ${selectedPacing.rateLimitCount} rate limits)`,
        isQueueVerificationMissing
          ? "Full-history verification: not run"
          : `Full-history verification: ${selectedVerification.complete ? "complete" : "incomplete"}`,
        `Queue state: ${selected.path}`,
      ].join(NEWLINE)}\n`,
    );
  }
};

export const runChatOrganizePause = async (settings: ChatOrganizationSettings): Promise<void> => {
  const selected = await findChatOrganizationQueue(
    readRepositoryRoot(settings.repo),
    settings.queue,
  );
  await pauseChatOrganizationQueue(selected.path, new Date().toISOString());
  const isRunning = selected.running;
  const message = isRunning
    ? "Pause requested; the active UI operation will finish before the queue releases its lock."
    : QUEUE_PAUSED_MESSAGE;

  const isMachineReadable = settings.json;
  if (isMachineReadable) {
    process.stdout.write(
      `${JSON.stringify({ state: isRunning ? PAUSING_STATUS : PAUSED_STATUS, queuePath: selected.path })}\n`,
    );
  } else process.stdout.write(`${message}\nQueue state: ${selected.path}\n`);
};

export const runChatOrganizeResume = async (settings: ChatOrganizationSettings): Promise<void> => {
  assertChatgptWorkspace(settings);

  const selected = await findChatOrganizationQueue(
    readRepositoryRoot(settings.repo),
    settings.queue,
  );

  const isRunning = selected.running;
  if (isRunning) return fail(`Organization queue is already running: ${selected.path}`);

  await clearChatOrganizationQueuePause(selected.path);
  const plan = JSON.stringify(
    selected.queue.items.map((element) => ({
      conversation: element.conversation,
      project: element.project,
    })),
  );
  return runChatOrganize({ ...settings, plan, restart: false, dryRun: false });
};

const listPlannedProjectNames = (tasks: readonly { readonly project: string }[]): string[] => {
  return tasks.map((task) => task.project);
};

const checkPlannedProjectsExist = async (
  settings: ChatOrganizationSettings,
  projectNames: string[],
): Promise<void> => {
  const { engine, page } = await startWorkspaceSession(settings);

  try {
    await readProjectIds(page, projectNames);
  } finally {
    await engine.shutDown({ closeBrowser: false });
  }
};

export const runChatOrganize = async (settings: ChatOrganizationSettings): Promise<void> => {
  assertChatgptWorkspace(settings);

  const plan = settings.plan;

  const isPlanMissing = plan == null || !plan.trim();
  if (isPlanMissing) {
    return failUsage("Usage: bridge chat organize --plan <fileOrJson>");
  }

  const interval = readOrganizationIntervalOption(settings.interval);
  const isAdaptive = settings.adaptive !== false;
  const minimumIntervalSeconds = readPositiveIntegerOption(
    settings.minInterval,
    "--min-interval",
    DEFAULT_ORGANIZATION_MIN_INTERVAL_SECONDS,
  );

  const maximumIntervalSeconds = readPositiveIntegerOption(
    settings.maxInterval,
    "--max-interval",
    DEFAULT_ORGANIZATION_MAX_INTERVAL_SECONDS,
  );

  const isIntervalInverted = maximumIntervalSeconds < minimumIntervalSeconds;
  if (isIntervalInverted) {
    return failUsage("--max-interval must be greater than or equal to --min-interval.");
  }

  const speedUpAfter = readPositiveIntegerOption(
    settings.speedUpAfter,
    "--speed-up-after",
    DEFAULT_ORGANIZATION_SPEED_UP_AFTER,
  );
  const cooldownSeconds = readPositiveIntegerOption(
    settings.cooldown,
    "--cooldown",
    DEFAULT_ORGANIZATION_COOLDOWN_SECONDS,
  );
  const maxAttempts = readPositiveIntegerOption(
    settings.maxAttempts,
    "--max-attempts",
    DEFAULT_ORGANIZATION_MAX_ATTEMPTS,
  );
  let tasks: Awaited<ReturnType<typeof loadChatOrganizationTasks>>;
  try {
    tasks = await loadChatOrganizationTasks(plan, process.cwd());
  } catch (error) {
    return fail(readCliFailureMessage(error));
  }
  const repoRoot = readRepositoryRoot(settings.repo);
  const queuePath = readChatOrganizationQueuePath(repoRoot, tasks);

  const isDryRun = settings.dryRun === true;
  if (isDryRun) {
    await checkPlannedProjectsExist(settings, listPlannedProjectNames(tasks));
    writeChatOrganizationDryRun({
      tasks,
      queuePath,
      interval,
      cooldownSeconds,
      maxAttempts,
      adaptive: isAdaptive,
      minimumIntervalSeconds,
      maximumIntervalSeconds,
      speedUpAfter,
      options: settings,
    });
    return;
  }

  let releaseQueueLock: () => Promise<void>;
  try {
    releaseQueueLock = await acquireChatOrganizationQueueLock(queuePath);
  } catch (error) {
    return fail(readCliFailureMessage(error));
  }
  let queue: ChatOrganizationQueue;
  try {
    const opened = await openChatOrganizationQueue({
      repoRoot,
      tasks,
      restart: Boolean(settings.restart),
      timestamp: new Date().toISOString(),
    });
    queue = opened.queue;

    if (isAdaptive) {
      const currentPacing = queue.pacing;
      const isPacingMissing = currentPacing == null;
      const pacing = isPacingMissing
        ? createInitialChatOrganizationPacing(
            Math.min(
              maximumIntervalSeconds,
              Math.max(
                minimumIntervalSeconds,
                pickNextChatOrganizationIntervalSeconds(interval, Math.random()),
              ),
            ),
          )
        : clampChatOrganizationPacing(currentPacing, {
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
    return fail(`Could not open the organization queue: ${readCliFailureMessage(error)}`);
  }
  const initialSummary = summarizeChatOrganizationQueue(queue);
  writeChatOrganizationProgress(
    `Organization queue: ${initialSummary.pending} pending of ${initialSummary.total}; state ${queuePath}`,
    settings,
  );

  const needsVerification = settings.verify !== false && queue.verification?.complete !== true;

  const isQueueDrainedWithoutVerification = initialSummary.pending === 0 && !needsVerification;
  if (isQueueDrainedWithoutVerification) {
    writeChatOrganizationSummary({ queuePath, queue, options: settings });
    await releaseQueueLock();

    const isOrganizationUnfinished =
      initialSummary.failed > 0 ||
      (settings.verify !== false && queue.verification?.complete !== true);
    if (isOrganizationUnfinished) {
      throw new Error("Chat organization has failed or unverified conversations.");
    }

    return;
  }

  let workspace: Awaited<ReturnType<typeof startWorkspaceSession>>;
  try {
    workspace = await startWorkspaceSession(settings);
  } catch (error) {
    await releaseQueueLock();
    throw error;
  }
  let workspaceWasShutdown = false;
  let isPaused = false;
  try {
    const projectIdByName = await readProjectIds(workspace.page, listPlannedProjectNames(tasks));
    let consecutiveRateLimitCooldowns = 0;
    let halted = false;
    while (!isPaused && !halted) {
      let index = findNextChatOrganizationQueueIndex(queue);
      while (index != null) {
        const isQueuePaused = await isChatOrganizationQueuePaused(queuePath);
        if (isQueuePaused) {
          isPaused = true;
          writeChatOrganizationProgress(
            "Organization queue pause acknowledged; no new UI operation will start.",
            settings,
          );
          break;
        }

        const element = queue.items[index];

        const isTaskNotPending = element == null || element.status !== PENDING_STATUS;
        if (isTaskNotPending) {
          index = findNextChatOrganizationQueueIndex(queue);
          continue;
        }

        const hasAcknowledgedRateLimit = await dismissChatGptHistoryRateLimit(workspace.page);
        if (hasAcknowledgedRateLimit) {
          consecutiveRateLimitCooldowns += 1;

          const pacingBeforeCooldown = queue.pacing;

          const isAdaptivePacingOn = isAdaptive && pacingBeforeCooldown != null;
          if (isAdaptivePacingOn) {
            queue = await persistChatOrganizationPacing({
              queue,
              queuePath,
              pacing: slowDownPacingAfterRateLimit(pacingBeforeCooldown, {
                maximumSeconds: maximumIntervalSeconds,
              }),
            });
          }

          const isCooldownLimitReached =
            consecutiveRateLimitCooldowns >= MAX_CONSECUTIVE_ORGANIZATION_COOLDOWNS;
          if (isCooldownLimitReached) {
            writeChatOrganizationProgress(
              `ChatGPT remained rate-limited after ${consecutiveRateLimitCooldowns} cooldowns; leaving the queue pending for a later resume.`,
              settings,
            );
            halted = true;
            break;
          }

          const pacingAfterPersist = queue.pacing;
          const isQueuePacingMissing = pacingAfterPersist == null;
          writeChatOrganizationProgress(
            `ChatGPT rate limit detected; cooling down for ${cooldownSeconds}s before continuing${isQueuePacingMissing ? SENTENCE_END : ` at a slower ${pacingAfterPersist.currentSeconds}s adaptive pace.`}`,
            settings,
          );

          const isWaitPaused =
            (await waitForOrganizationInterval(cooldownSeconds, queuePath)) === PAUSED_STATUS;
          if (isWaitPaused) {
            isPaused = true;
            break;
          }

          continue;
        }

        consecutiveRateLimitCooldowns = 0;
        writeChatOrganizationProgress(
          `Moving "${element.conversation}" -> ${element.project} (attempt ${element.attempts + 1}/${maxAttempts})`,
          settings,
        );
        let moveVerdict: MoveChatVerdict | undefined;
        let thrownReason: string | undefined;
        try {
          moveVerdict = await moveChatToProject(workspace.page, {
            chat: element.conversation,
            project: element.project,
            projectId: readProjectIdNamed(projectIdByName, element.project),
          });
        } catch (error) {
          thrownReason = readCliFailureMessage(error);
        }
        const isSessionClosed = isChatOrganizationSessionClosed(thrownReason);
        const isRateLimitedOnPage = await dismissChatGptHistoryRateLimit(workspace.page);
        const isRateLimitedByMove = moveVerdict?.rateLimited === true;
        const isRateLimited = isRateLimitedOnPage || isRateLimitedByMove;
        queue = await saveChatOrganizationAttempt({
          queue,
          queuePath,
          index,
          maxAttempts,
          sessionClosed: isSessionClosed,
          rateLimited: isRateLimited,
          moveOutcome: moveVerdict,
          thrownReason,
        });

        const pacingAfterAttempt = queue.pacing;

        const hasAdaptivePacing = isAdaptive && pacingAfterAttempt != null;
        if (hasAdaptivePacing) {
          let pacing = pacingAfterAttempt;

          const isMoveSuccessful = Boolean(moveVerdict?.moved || moveVerdict?.alreadyFiled);
          const hasSuccessStreak = pacing.successStreak > 0;

          if (isRateLimited) {
            pacing = slowDownPacingAfterRateLimit(pacing, {
              maximumSeconds: maximumIntervalSeconds,
            });
          } else if (isMoveSuccessful) {
            pacing = speedUpPacingAfterSuccess(pacing, {
              minimumSeconds: minimumIntervalSeconds,
              speedUpAfter,
            });
          } else if (hasSuccessStreak) {
            pacing = { ...pacing, successStreak: 0 };
          }

          queue = await persistChatOrganizationPacing({ queue, queuePath, pacing });
        }

        if (isSessionClosed) {
          writeChatOrganizationProgress(
            "ChatGPT browser session closed; reopening it without consuming a retry attempt.",
            settings,
          );
          await workspace.engine.shutDown({ closeBrowser: false });
          workspaceWasShutdown = true;
          try {
            workspace = await startWorkspaceSession(settings);
            workspaceWasShutdown = false;
          } catch (error) {
            writeChatOrganizationProgress(
              `Could not reopen the ChatGPT browser session; leaving the queue pending: ${readCliFailureMessage(
                error,
              )}`,
              settings,
            );
            halted = true;
            break;
          }
          index = findNextChatOrganizationQueueIndex(queue);
          continue;
        }

        const recorded = queue.items[index];

        const isRecordedStatusMoved = recorded?.status === MOVED_STATUS;
        const isRecordedStatusAlreadyFiled = recorded?.status === ALREADY_FILED_STATUS;
        const isRecordedStatusFailed = recorded?.status === FAILED_STATUS;
        const isRecordedStatusPending = recorded?.status === PENDING_STATUS;

        if (isRecordedStatusMoved) {
          writeChatOrganizationProgress(`Moved "${recorded.conversation}".`, settings);
        } else if (isRecordedStatusAlreadyFiled) {
          writeChatOrganizationProgress(`Already filed "${recorded.conversation}".`, settings);
        } else if (isRecordedStatusFailed) {
          writeChatOrganizationProgress(
            `Failed "${recorded.conversation}" after ${recorded.attempts} attempts: ${recorded.reason}`,
            settings,
          );
        } else if (isRecordedStatusPending) {
          let reason = "unknown failure";

          const recordedLastReason = recorded.lastReason;

          const hasRecordedLastReason = recordedLastReason != null;
          if (hasRecordedLastReason) reason = recordedLastReason;

          writeChatOrganizationProgress(
            `Will retry "${recorded.conversation}": ${reason}`,
            settings,
          );
        }

        const pacingBeforeWait = queue.pacing;
        const isAdaptiveWithQueuePacing = isAdaptive && pacingBeforeWait != null;
        let waitSeconds = isAdaptiveWithQueuePacing
          ? pickNextAdaptiveChatOrganizationIntervalSeconds(pacingBeforeWait, Math.random())
          : pickNextChatOrganizationIntervalSeconds(interval, Math.random());

        if (isRateLimited) {
          consecutiveRateLimitCooldowns += 1;
          waitSeconds = cooldownSeconds;
        }

        index = findNextChatOrganizationQueueIndex(queue);

        const hasIndex = index != null;
        if (hasIndex) {
          writeChatOrganizationProgress(
            `Waiting ${waitSeconds}s before the next UI operation${isAdaptive ? " (adaptive)." : SENTENCE_END}`,
            settings,
          );

          const isIntervalWaitPaused =
            (await waitForOrganizationInterval(waitSeconds, queuePath)) === PAUSED_STATUS;
          if (isIntervalWaitPaused) {
            isPaused = true;
            break;
          }
        }
      }

      const isRunSuspended = isPaused || halted;
      if (isRunSuspended) break;

      const isQueueVerified =
        settings.verify !== false && summarizeChatOrganizationQueue(queue).pending === 0;
      if (isQueueVerified) {
        queue = await verifyCompletedChatOrganizationQueue({
          queue,
          queuePath,
          workspace,
          options: settings,
          maxAttempts,
        });
      }

      const reopened = findNextChatOrganizationQueueIndex(queue);

      const isReopenedMissing = reopened == null;
      if (isReopenedMissing) break;

      writeChatOrganizationProgress(
        "The full-history audit found planned Conversations still loose; retrying them automatically.",
        settings,
      );
      consecutiveRateLimitCooldowns = 0;
    }
  } finally {
    try {
      const isWorkspaceNotShutdown = !workspaceWasShutdown;
      if (isWorkspaceNotShutdown) await workspace.engine.shutDown({ closeBrowser: false });
    } finally {
      await releaseQueueLock();
    }
  }
  const summary = summarizeChatOrganizationQueue(queue);
  writeChatOrganizationSummary({ queuePath, queue, options: settings, paused: isPaused });

  if (isPaused) return;

  const isOrganizationIncomplete =
    summary.failed > 0 ||
    summary.pending > 0 ||
    (settings.verify !== false && queue.verification?.complete !== true);
  if (isOrganizationIncomplete) {
    throw new Error("Chat organization has pending, failed or unverified conversations.");
  }
};
