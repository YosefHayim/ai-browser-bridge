import type { FanoutTask } from "./bridge-schemas.ts";

const DEFAULT_FANOUT_CONCURRENCY = 1;
const DEFAULT_FANOUT_TIMEOUT_MS = 300_000;
const DEFAULT_FANOUT_MAX_REPLY_CHARS = 2_000;
const DEFAULT_FANOUT_LIMIT = 20;

export type FanoutTarget = {
  provider: string;
  mode: "new" | "existing";
  /** Conversation id when the provider exposes one in its URL, else null. */
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
  timeoutMs?: number;
  maxReplyChars?: number;
  limit?: number;
  offset?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
};

const raceWithTimeout = <Reply>(
  promise: Promise<Reply>,
  ms: number,
  label: string,
): Promise<Reply> => {
  return new Promise<Reply>((fulfill, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (field) => {
        clearTimeout(timer);
        fulfill(field);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
};

const labelForTask = (task: FanoutTask, index: number): string => {
  const hasTaskLabel = task.label != null;
  if (hasTaskLabel) return task.label;

  return `task ${index + 1}`;
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
  const truncated = taskReply.reply.length > maxReplyChars;
  let reply = taskReply.reply;

  if (truncated) reply = taskReply.reply.slice(0, maxReplyChars);

  const taskReport: FanoutTaskReport = {
    target: taskReply.target,
    ok: true,
    reply: reply,
    elapsedMs,
  };

  const hasTaskLabel = task.label != null;
  if (hasTaskLabel) taskReport.label = task.label;

  if (truncated) {
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

/**
 * Run an ordered array of fan-out tasks through a bounded pool and return one row per task.
 *
 * Never rejects — each task's outcome is captured independently, so one slow or failed
 * Conversation never blocks or fails the rest. At most `maxConcurrency` tasks run at once;
 * `offset`/`limit` window which tasks run; each reply is truncated to `maxReplyChars`.
 * Browser work is injected as `runOne`, keeping this core pure and testable.
 */
export const runFanoutTasks = async (
  tasks: readonly FanoutTask[],
  runOne: (task: FanoutTask, index: number) => Promise<FanoutTaskReply>,
  settings: FanoutSettings = {},
): Promise<FanoutReport> => {
  let readClock = (): number => Date.now();

  const isNowGiven = settings.now != null;

  if (isNowGiven) readClock = settings.now;

  let maxConcurrency = DEFAULT_FANOUT_CONCURRENCY;
  if (settings.maxConcurrency != null) maxConcurrency = settings.maxConcurrency;

  const wholeMaxConcurrency = Math.floor(maxConcurrency);
  maxConcurrency = Math.max(1, wholeMaxConcurrency);

  let maxReplyChars = DEFAULT_FANOUT_MAX_REPLY_CHARS;
  if (settings.maxReplyChars != null) maxReplyChars = settings.maxReplyChars;

  const wholeMaxReplyChars = Math.floor(maxReplyChars);
  maxReplyChars = Math.max(1, wholeMaxReplyChars);

  let timeoutMs = DEFAULT_FANOUT_TIMEOUT_MS;
  if (settings.timeoutMs != null) timeoutMs = settings.timeoutMs;

  let limit = DEFAULT_FANOUT_LIMIT;
  if (settings.limit != null) limit = settings.limit;

  const wholeLimit = Math.floor(limit);
  limit = Math.max(1, wholeLimit);

  const total = tasks.length;

  let offset = 0;
  if (settings.offset != null) offset = Math.floor(settings.offset);

  const nonNegativeOffset = Math.max(0, offset);
  offset = Math.min(nonNegativeOffset, total);

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
          timeoutMs,
          labelForTask(task, globalIndex),
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

/** True when the run should exit non-zero: no tasks, all failed, or (strict) any failed. */
export const fanoutFailed = (fanout: FanoutReport, strict: boolean): boolean => {
  const hasNoTasks = fanout.total === 0;
  if (hasNoTasks) return true;

  const hasNoReports = fanout.results.length === 0;
  if (hasNoReports) return false;

  if (strict) return fanout.results.some((taskReport) => !taskReport.ok);

  return fanout.results.every((taskReport) => !taskReport.ok);
};
