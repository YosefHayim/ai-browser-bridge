import type { FanoutTask } from "./bridgeSchemas.ts";

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

export type FanoutTaskResult = {
  label?: string;
  target: FanoutTarget | null;
  ok: boolean;
  reply?: string;
  truncated?: boolean;
  replyChars?: number;
  error?: string;
  elapsedMs: number;
};

export type FanoutResult = {
  total: number;
  offset: number;
  limit: number;
  nextOffset: number | null;
  results: FanoutTaskResult[];
};

export type FanoutOptions = {
  maxConcurrency?: number;
  timeoutMs?: number;
  maxReplyChars?: number;
  limit?: number;
  offset?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
};

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
};

const labelForTask = (task: FanoutTask, index: number): string => {
  if (task.label !== undefined) return task.label;
  return `task ${index + 1}`;
};

const successfulTaskRow = (
  task: FanoutTask,
  taskReply: FanoutTaskReply,
  maxReplyChars: number,
  elapsedMs: number,
): FanoutTaskResult => {
  const truncated = taskReply.reply.length > maxReplyChars;
  let replyText = taskReply.reply;
  if (truncated) replyText = taskReply.reply.slice(0, maxReplyChars);
  const row: FanoutTaskResult = {
    target: taskReply.target,
    ok: true,
    reply: replyText,
    elapsedMs,
  };
  if (task.label !== undefined) row.label = task.label;
  if (truncated) {
    row.truncated = true;
    row.replyChars = taskReply.reply.length;
  }
  return row;
};

const failedTaskRow = (task: FanoutTask, error: unknown, elapsedMs: number): FanoutTaskResult => {
  let errorMessage: string;
  if (error instanceof Error) {
    errorMessage = error.message;
  } else {
    errorMessage = String(error);
  }
  const row: FanoutTaskResult = {
    target: null,
    ok: false,
    error: errorMessage,
    elapsedMs,
  };
  if (task.label !== undefined) row.label = task.label;
  return row;
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
  options: FanoutOptions = {},
): Promise<FanoutResult> => {
  let clock = (): number => Date.now();
  if (options.now !== undefined) clock = options.now;

  let maxConcurrency = DEFAULT_FANOUT_CONCURRENCY;
  if (options.maxConcurrency !== undefined) maxConcurrency = options.maxConcurrency;
  maxConcurrency = Math.max(1, Math.floor(maxConcurrency));

  let maxReplyChars = DEFAULT_FANOUT_MAX_REPLY_CHARS;
  if (options.maxReplyChars !== undefined) maxReplyChars = options.maxReplyChars;
  maxReplyChars = Math.max(1, Math.floor(maxReplyChars));

  let timeoutMs = DEFAULT_FANOUT_TIMEOUT_MS;
  if (options.timeoutMs !== undefined) timeoutMs = options.timeoutMs;

  let limit = DEFAULT_FANOUT_LIMIT;
  if (options.limit !== undefined) limit = options.limit;
  limit = Math.max(1, Math.floor(limit));

  const total = tasks.length;
  let offset = 0;
  if (options.offset !== undefined) offset = Math.floor(options.offset);
  offset = Math.min(Math.max(0, offset), total);

  const windowTasks = tasks.slice(offset, offset + limit);
  const taskRows = new Array<FanoutTaskResult>(windowTasks.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < windowTasks.length) {
      const localIndex = cursor++;
      const task = windowTasks[localIndex];
      if (task === undefined) continue;
      const globalIndex = offset + localIndex;
      const startedAt = clock();
      try {
        const taskReply = await withTimeout(
          runOne(task, globalIndex),
          timeoutMs,
          labelForTask(task, globalIndex),
        );
        taskRows[localIndex] = successfulTaskRow(
          task,
          taskReply,
          maxReplyChars,
          clock() - startedAt,
        );
      } catch (error) {
        taskRows[localIndex] = failedTaskRow(task, error, clock() - startedAt);
      }
    }
  };
  const workerCount = Math.min(maxConcurrency, windowTasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  const consumed = offset + windowTasks.length;
  let nextOffset: number | null = null;
  if (consumed < total) nextOffset = consumed;
  return { total, offset, limit, nextOffset, results: taskRows };
};

/** True when the run should exit non-zero: no tasks, all failed, or (strict) any failed. */
export const fanoutFailed = (fanout: FanoutResult, strict: boolean): boolean => {
  if (fanout.total === 0) return true;
  if (fanout.results.length === 0) return false;
  if (strict) return fanout.results.some((row) => !row.ok);
  return fanout.results.every((row) => !row.ok);
};
