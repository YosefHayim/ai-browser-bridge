import type { FanOutTask } from "@/bridge-engine/bridge-schemas.ts";
import { readErrorMessage } from "@/read-error-message.ts";

const DEFAULT_FAN_OUT_CONCURRENCY = 1;
const DEFAULT_FAN_OUT_TIMEOUT_MILLISECONDS = 300_000;
const DEFAULT_FAN_OUT_MAX_REPLY_CHARS = 2_000;
const DEFAULT_FAN_OUT_LIMIT = 20;

export type FanOutTarget = {
  provider: string;
  mode: "new" | "existing";
  id: string | null;
  url: string | null;
  isolate: string | null;
};

export type FanOutTaskReply = {
  reply: string;
  target: FanOutTarget;
};

export type FanOutTaskReport = {
  label?: string;
  target: FanOutTarget | null;
  ok: boolean;
  reply?: string;
  truncated?: boolean;
  replyChars?: number;
  error?: string;
  elapsedMs: number;
};

export type FanOutReport = {
  total: number;
  offset: number;
  limit: number;
  nextOffset: number | null;
  taskReports: FanOutTaskReport[];
};

export type FanOutSettings = {
  maxConcurrency?: number;
  timeoutMilliseconds?: number;
  maxReplyChars?: number;
  limit?: number;
  offset?: number;
  now?: () => number;
};

async function raceWithTimeout<Reply>(
  promise: Promise<Reply>,
  ms: number,
  label: string,
): Promise<Reply> {
  const timeoutSignal = AbortSignal.timeout(ms);
  const timeoutFailure = new Promise<never>((_, reject) => {
    timeoutSignal.addEventListener(
      "abort",
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      { once: true },
    );
  });

  return Promise.race([promise, timeoutFailure]);
}

function readTaskLabel(task: FanOutTask, index: number): string {
  return task.label ?? `task ${index + 1}`;
}

interface ReadSuccessfulTaskStoredDetails {
  task: FanOutTask;
  taskReply: FanOutTaskReply;
  maxReplyChars: number;
  elapsedMs: number;
}

function readSuccessfulTask({
  task,
  taskReply,
  maxReplyChars,
  elapsedMs,
}: ReadSuccessfulTaskStoredDetails): FanOutTaskReport {
  const isTruncated = taskReply.reply.length > maxReplyChars;
  let reply = taskReply.reply;

  if (isTruncated) reply = taskReply.reply.slice(0, maxReplyChars);

  const taskReport: FanOutTaskReport = {
    target: taskReply.target,
    ok: true,
    reply: reply,
    elapsedMs,
  };

  const hasTaskLabel = task.label != null;
  if (hasTaskLabel) taskReport.label = task.label;

  if (isTruncated) {
    taskReport.truncated = true;
    taskReport.replyChars = taskReply.reply.length;
  }

  return taskReport;
}

function createFailedTask(task: FanOutTask, error: unknown, elapsedMs: number): FanOutTaskReport {
  const errorMessage = readErrorMessage(error);

  const taskReport: FanOutTaskReport = {
    target: null,
    ok: false,
    error: errorMessage,
    elapsedMs,
  };

  const hasTaskLabel = task.label != null;
  if (hasTaskLabel) taskReport.label = task.label;

  return taskReport;
}

export async function runFanOutTasks(
  tasks: readonly FanOutTask[],
  runOne: (task: FanOutTask, index: number) => Promise<FanOutTaskReply>,
  settings: FanOutSettings = {},
): Promise<FanOutReport> {
  const readClock = settings.now ?? (() => Date.now());

  const requestedConcurrency = settings.maxConcurrency ?? DEFAULT_FAN_OUT_CONCURRENCY;
  const wholeMaxConcurrency = Math.floor(requestedConcurrency);
  const maxConcurrency = Math.max(1, wholeMaxConcurrency);

  const requestedMaxReplyChars = settings.maxReplyChars ?? DEFAULT_FAN_OUT_MAX_REPLY_CHARS;
  const wholeMaxReplyChars = Math.floor(requestedMaxReplyChars);
  const maxReplyChars = Math.max(1, wholeMaxReplyChars);

  const timeoutMilliseconds = settings.timeoutMilliseconds ?? DEFAULT_FAN_OUT_TIMEOUT_MILLISECONDS;

  const requestedLimit = settings.limit ?? DEFAULT_FAN_OUT_LIMIT;
  const wholeLimit = Math.floor(requestedLimit);
  const limit = Math.max(1, wholeLimit);

  const total = tasks.length;

  const requestedOffset = settings.offset ?? 0;
  const wholeOffset = Math.floor(requestedOffset);
  const nonNegativeOffset = Math.max(0, wholeOffset);
  const offset = Math.min(nonNegativeOffset, total);

  const windowTasks = tasks.slice(offset, offset + limit);
  const storedTaskList = new Array<FanOutTaskReport>(windowTasks.length);
  let cursor = 0;
  async function runWorker(): Promise<void> {
    while (cursor < windowTasks.length) {
      const localIndex = cursor++;
      const task = windowTasks[localIndex];

      const isTaskMissing = task == null;
      if (isTaskMissing) continue;

      const globalIndex = offset + localIndex;
      const startedAt = readClock();
      try {
        const taskReply = await raceWithTimeout(
          runOne(task, globalIndex),
          timeoutMilliseconds,
          readTaskLabel(task, globalIndex),
        );
        storedTaskList[localIndex] = readSuccessfulTask({
          task,
          taskReply,
          maxReplyChars,
          elapsedMs: readClock() - startedAt,
        });
      } catch (error) {
        storedTaskList[localIndex] = createFailedTask(task, error, readClock() - startedAt);
      }
    }
  }
  const workerCount = Math.min(maxConcurrency, windowTasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  const consumed = offset + windowTasks.length;
  let nextOffset: number | null = null;

  const hasUnconsumedTasks = consumed < total;
  if (hasUnconsumedTasks) nextOffset = consumed;

  return { total, offset, limit, nextOffset, taskReports: storedTaskList };
}

export function isFanOutFailed(fanOut: FanOutReport, isStrict: boolean): boolean {
  const hasNoTasks = fanOut.total === 0;
  if (hasNoTasks) return true;

  const hasNoReports = fanOut.taskReports.length === 0;
  if (hasNoReports) return false;

  if (isStrict) return fanOut.taskReports.some((taskReport) => !taskReport.ok);

  return fanOut.taskReports.every((taskReport) => !taskReport.ok);
}
