import type { FanoutTask } from "./bridgeSchemas.ts";

/** Default number of Conversations a fan-out drives at once (serial by design). */
const DEFAULT_FANOUT_CONCURRENCY = 1;
/** Default per-task reply timeout in milliseconds. */
const DEFAULT_FANOUT_TIMEOUT_MS = 300_000;
/** Default reply truncation ceiling, in characters, so a large fan-out cannot flood context. */
const DEFAULT_FANOUT_MAX_REPLY_CHARS = 2_000;
/** Default pagination window: max tasks run and returned per call. */
const DEFAULT_FANOUT_LIMIT = 20;

/** The resolved Conversation a task drove: its provider, whether it was new, and how to reopen it. */
export type FanoutTarget = {
  provider: string;
  mode: "new" | "existing";
  /** Conversation id when the provider exposes one in its URL, else null. */
  id: string | null;
  /** Conversation URL captured after the reply (reopen cheaply with this). */
  url: string | null;
  /** Isolated profile name when the task ran in a separate Chrome, else null. */
  isolate: string | null;
};

/** What runFanoutTasks' injected runOne returns for a successful task. */
export type FanoutTaskReply = {
  reply: string;
  target: FanoutTarget;
};

/** One row of a fan-out — the outcome of a single task, in input order. */
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

/** Ordered window of task rows plus its pagination cursor. */
export type FanoutResult = {
  total: number;
  offset: number;
  limit: number;
  nextOffset: number | null;
  results: FanoutTaskResult[];
};

/** Tunable knobs for runFanoutTasks. */
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
  reply: FanoutTaskReply,
  maxReplyChars: number,
  elapsedMs: number,
): FanoutTaskResult => {
  const truncated = reply.reply.length > maxReplyChars;
  const row: FanoutTaskResult = {
    target: reply.target,
    ok: true,
    reply: truncated ? reply.reply.slice(0, maxReplyChars) : reply.reply,
    elapsedMs,
  };
  if (task.label !== undefined) row.label = task.label;
  if (truncated) {
    row.truncated = true;
    row.replyChars = reply.reply.length;
  }
  return row;
};

const failedTaskRow = (task: FanoutTask, error: unknown, elapsedMs: number): FanoutTaskResult => {
  const row: FanoutTaskResult = {
    target: null,
    ok: false,
    error: error instanceof Error ? error.message : String(error),
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
      if (!task) continue;
      const globalIndex = offset + localIndex;
      const start = clock();
      try {
        const reply = await withTimeout(
          runOne(task, globalIndex),
          timeoutMs,
          labelForTask(task, globalIndex),
        );
        taskRows[localIndex] = successfulTaskRow(task, reply, maxReplyChars, clock() - start);
      } catch (error) {
        taskRows[localIndex] = failedTaskRow(task, error, clock() - start);
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

/**
 * Whether the run should exit non-zero: no tasks at all, all tasks failed, or (strict) any failed.
 * When `strict` is true, any single failure counts; otherwise only an all-fail does.
 */
export const fanoutFailed = (fanout: FanoutResult, strict: boolean): boolean => {
  if (fanout.total === 0) return true;
  if (fanout.results.length === 0) return false;
  if (strict) return fanout.results.some((row) => !row.ok);
  return fanout.results.every((row) => !row.ok);
};
