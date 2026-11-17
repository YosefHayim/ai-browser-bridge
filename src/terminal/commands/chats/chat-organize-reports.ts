import { NEWLINE } from "@/terminal/cli/cli-text.ts";
import type { ChatOrganizationSettings } from "@/terminal/cli/cli-types.ts";
import {
  type ChatOrganizationInterval,
  type ChatOrganizationQueue,
  type loadChatOrganizationTasks,
  readChatOrganizationIntervalLabel,
  summarizeChatOrganizationQueue,
} from "@/terminal/commands/chats/chat-organization-queue.ts";

export const QUEUE_PAUSED_MESSAGE = "Organization queue paused.";

export function writeChatOrganizationProgress(
  message: string,
  settings: ChatOrganizationSettings,
): void {
  const isMachineReadable = settings.json;
  if (isMachineReadable) {
    process.stderr.write(`${message}\n`);
    return;
  }

  process.stdout.write(`${message}\n`);
}

export function writeChatOrganizationSummary(details: {
  queuePath: string;
  queue: ChatOrganizationQueue;
  options: ChatOrganizationSettings;
  paused?: boolean;
}): void {
  const summary = summarizeChatOrganizationQueue(details.queue);

  const isMachineReadable = details.options.json;
  if (isMachineReadable) {
    const isPaused = details.paused === true;
    process.stdout.write(
      `${JSON.stringify({
        queuePath: details.queuePath,
        state: isPaused ? "paused" : "finished",
        summary,
        pacing: details.queue.pacing,
        verification: details.queue.verification,
      })}\n`,
    );
    return;
  }

  const queuePacing = details.queue.pacing;
  const queueVerification = details.queue.verification;
  const isQueuePacingMissing = queuePacing == null;
  const isQueueVerificationMissing = queueVerification == null;
  const isQueuePaused = details.paused;
  process.stdout.write(
    `${[
      isQueuePaused ? QUEUE_PAUSED_MESSAGE : "Organization queue finished.",
      `Moved: ${summary.moved}`,
      `Already filed: ${summary.alreadyFiled}`,
      `Pending: ${summary.pending}`,
      `Failed: ${summary.failed}`,
      isQueuePacingMissing
        ? undefined
        : `Adaptive pace: ${queuePacing.currentSeconds}s base (${queuePacing.rateLimitCount} rate limits)`,
      isQueueVerificationMissing
        ? undefined
        : `Full-history verification: ${queueVerification.complete ? "complete" : "incomplete"}; ${queueVerification.remainingOrphans} intentional/remaining orphans`,
      `Queue state: ${details.queuePath}`,
    ]
      .filter((line) => line != null)
      .join(NEWLINE)}\n`,
  );
}

export function writeChatOrganizationDryRun(details: {
  tasks: Awaited<ReturnType<typeof loadChatOrganizationTasks>>;
  queuePath: string;
  interval: ChatOrganizationInterval;
  cooldownSeconds: number;
  maxAttempts: number;
  adaptive: boolean;
  minimumIntervalSeconds: number;
  maximumIntervalSeconds: number;
  speedUpAfter: number;
  options: ChatOrganizationSettings;
}): void {
  const preview = {
    dryRun: true,
    queuePath: details.queuePath,
    interval: details.interval,
    cooldownSeconds: details.cooldownSeconds,
    maxAttempts: details.maxAttempts,
    adaptive: details.adaptive,
    minimumIntervalSeconds: details.minimumIntervalSeconds,
    maximumIntervalSeconds: details.maximumIntervalSeconds,
    speedUpAfter: details.speedUpAfter,
    tasks: details.tasks,
  };

  const isMachineReadable = details.options.json;
  if (isMachineReadable) {
    process.stdout.write(`${JSON.stringify(preview)}\n`);
    return;
  }

  const isAdaptive = details.adaptive;
  process.stdout.write(
    `${[
      `Organization queue dry run: ${details.tasks.length} Conversations`,
      `Interval: ${readChatOrganizationIntervalLabel(details.interval)}`,
      `Adaptive pacing: ${isAdaptive ? `yes (${details.minimumIntervalSeconds}-${details.maximumIntervalSeconds}s; speed up after ${details.speedUpAfter} successes)` : "no"}`,
      `Rate-limit cooldown: ${details.cooldownSeconds}s`,
      `Attempts per Conversation: ${details.maxAttempts}`,
      `Resume state: ${details.queuePath}`,
      ...details.tasks.map((task) => `  ${task.conversation} -> ${task.project}`),
    ].join(NEWLINE)}\n`,
  );
}
