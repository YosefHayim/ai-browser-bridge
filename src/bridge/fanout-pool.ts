import type { FanoutTask } from "./bridge-schemas.ts";

const DEFAULT_FANOUT_CONCURRENCY = 1;
const DEFAULT_FANOUT_TIMEOUT_MILLISECONDS = 300_000;
const DEFAULT_FANOUT_MAX_REPLY_CHARS = 2_000;
const DEFAULT_FANOUT_LIMIT = 20;

export type FanoutTarget = {
  provider: string;
  mode: "new" | "existing";
  id: string | null;
  url: string | null;
  isolate: string | null;
};

export type FanoutTaskReply = {
  reply: string;
  target: FanoutTarget;
};

export type FanoutTaskReport = {
  label?: string;
  target: FanoutTarget | null;
  ok: boolean;
  reply?: string;
  truncated?: boolean;
  replyChars?: number;
  error?: string;
  elapsedMs: number;
};

export type FanoutReport = {
  total: number;
  offset: number;
  limit: number;
  nextOffset: number | null;
  results: FanoutTaskReport[];
};

export type FanoutSettings = {
  maxConcurrency?: number;
  timeoutMilliseconds?: number;
  maxReplyChars?: number;
  limit?: number;
  offset?: number;
  now?: () => number;
};

const raceWithTimeout = async <Reply>(
  promise: Promise<Reply>,
  ms: number,
  label: string,
): Promise<Reply> => {
  const timeoutSignal = AbortSignal.timeout(ms);
  const timeoutFailure = new Promise<never>((_, reject) => {
    timeoutSignal.addEventListener(
      "abort",
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      { once: true },
    );
  });

  return Promise.race([promise, timeoutFailure]);
};

const readTaskLabel = (task: FanoutTask, index: number): string => {
  return task.label ?? `task ${index + 1}`;
};

interface ReadSuccessfulTaskStoredDetails {
  task: FanoutTask;
  taskReply: FanoutTaskReply;
  maxReplyChars: number;
  elapsedMs: number;
}

const createSuccessfulTask = ({
  task,
  taskReply,
  maxReplyChars,
  elapsedMs,
}: ReadSuccessfulTaskStoredDetails): FanoutTaskReport => {
  const isTruncated = taskReply.reply.length > maxReplyChars;
  let reply = taskReply.reply;

  if (isTruncated) reply = taskReply.reply.slice(0, maxReplyChars);

  const taskReport: FanoutTaskReport = {
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
};

const createFailedTask = (
  task: FanoutTask,
  error: unknown,
  elapsedMs: number,
): FanoutTaskReport => {
  let errorMessage: string;

  const isErrorObject = error instanceof Error;
  if (isErrorObject) {
    errorMessage = error.message;
  } else {
    errorMessage = String(error);
  }

  const taskReport: FanoutTaskReport = {
    target: null,
    ok: false,
    error: errorMessage,
    elapsedMs,
  };

  const hasTaskLabel = task.label != null;
  if (hasTaskLabel) taskReport.label = task.label;

  return taskReport;
};

export const runFanoutTasks = async (
  tasks: readonly FanoutTask[],
  runOne: (task: FanoutTask, index: number) => Promise<FanoutTaskReply>,
  settings: FanoutSettings = {},
): Promise<FanoutReport> => {
  const readClock = settings.now ?? (() => Date.now());

  const requestedConcurrency = settings.maxConcurrency ?? DEFAULT_FANOUT_CONCURRENCY;
  const wholeMaxConcurrency = Math.floor(requestedConcurrency);
  const maxConcurrency = Math.max(1, wholeMaxConcurrency);

  const requestedMaxReplyChars = settings.maxReplyChars ?? DEFAULT_FANOUT_MAX_REPLY_CHARS;
  const wholeMaxReplyChars = Math.floor(requestedMaxReplyChars);
  const maxReplyChars = Math.max(1, wholeMaxReplyChars);

  const timeoutMilliseconds = settings.timeoutMilliseconds ?? DEFAULT_FANOUT_TIMEOUT_MILLISECONDS;

  const requestedLimit = settings.limit ?? DEFAULT_FANOUT_LIMIT;
  const wholeLimit = Math.floor(requestedLimit);
  const limit = Math.max(1, wholeLimit);

  const total = tasks.length;

  const requestedOffset = settings.offset ?? 0;
  const wholeOffset = Math.floor(requestedOffset);
  const nonNegativeOffset = Math.max(0, wholeOffset);
  const offset = Math.min(nonNegativeOffset, total);

  const windowTasks = tasks.slice(offset, offset + limit);
  const storedTaskList = new Array<FanoutTaskReport>(windowTasks.length);
  let cursor = 0;
  const runWorker = async (): Promise<void> => {
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
        storedTaskList[localIndex] = createSuccessfulTask({
          task,
          taskReply,
          maxReplyChars,
          elapsedMs: readClock() - startedAt,
        });
      } catch (error) {
        storedTaskList[localIndex] = createFailedTask(task, error, readClock() - startedAt);
      }
    }
  };
  const workerCount = Math.min(maxConcurrency, windowTasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  const consumed = offset + windowTasks.length;
  let nextOffset: number | null = null;

  const hasUnconsumedTasks = consumed < total;
  if (hasUnconsumedTasks) nextOffset = consumed;

  return { total, offset, limit, nextOffset, results: storedTaskList };
};

export const isFanoutFailed = (fanout: FanoutReport, isStrict: boolean): boolean => {
  const hasNoTasks = fanout.total === 0;
  if (hasNoTasks) return true;

  const hasNoReports = fanout.results.length === 0;
  if (hasNoReports) return false;

  if (isStrict) return fanout.results.some((taskReport) => !taskReport.ok);

  return fanout.results.every((taskReport) => !taskReport.ok);
};
