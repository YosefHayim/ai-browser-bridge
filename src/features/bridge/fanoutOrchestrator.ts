import type { FanoutTask } from "./bridgeSchemas.ts";

/** Default number of Conversations a fan-out drives at once (serial by design). */
const DEFAULT_FANOUT_CONCURRENCY = 1;
/** Default per-task reply timeout in milliseconds. */
const DEFAULT_FANOUT_TIMEOUT_MS = 300_000;
/** Default reply truncation ceiling, in characters, so a big batch cannot flood context. */
const DEFAULT_FANOUT_MAX_REPLY_CHARS = 2_000;
/** Default pagination window: max tasks run and returned per call. */
const DEFAULT_FANOUT_LIMIT = 20;

/** The resolved Conversation a task drove: its provider, whether it was new, and how to reopen it. */
export interface FanoutTarget {
  /** Provider id the task resolved to. */
  provider: string;
  /** Whether the task opened a new Conversation or resumed an existing one. */
  mode: "new" | "existing";
  /** Conversation id when the provider exposes one in its URL, else null. */
  id: string | null;
  /** Conversation URL captured after the reply (reopen cheaply with this). */
  url: string | null;
  /** Isolated profile name when the task ran in a separate Chrome, else null. */
  isolate: string | null;
}

/** What {@link runFanoutTasks}'s injected `runOne` returns for a successful task. */
export interface FanoutTaskReply {
  /** Full captured reply text (the core truncates it for the result row). */
  reply: string;
  /** The resolved Conversation the reply came from. */
  target: FanoutTarget;
}

/** One row of a fan-out result — the outcome of a single task, in input order. */
export interface FanoutTaskResult {
  /** Caller label echoed from the task, when it set one. */
  label?: string;
  /** Resolved Conversation on success; null when the task failed before capture. */
  target: FanoutTarget | null;
  /** Whether the task captured a reply. */
  ok: boolean;
  /** Reply text, truncated to `maxReplyChars`; present only on success. */
  reply?: string;
  /** True when `reply` was cut to `maxReplyChars`. */
  truncated?: boolean;
  /** Full reply length before truncation; present only when truncated. */
  replyChars?: number;
  /** Failure reason; present only when `ok` is false. */
  error?: string;
  /** Wall time spent on this task, in milliseconds. */
  elapsedMs: number;
}

/** A fan-out result: an ordered window of task rows plus its pagination cursor. */
export interface FanoutBatchResult {
  /** Total tasks supplied (before the pagination window). */
  total: number;
  /** Offset the returned window started at. */
  offset: number;
  /** Window size that was applied. */
  limit: number;
  /** Offset to pass next to run the following window, or null when none remain. */
  nextOffset: number | null;
  /** One row per task in the window, in input order. */
  results: FanoutTaskResult[];
}

/** Tunable knobs for {@link runFanoutTasks}. */
export interface FanoutBatchOptions {
  /** Max Conversations in flight at once (default 1 — serial). */
  maxConcurrency?: number;
  /** Per-task timeout in ms (default 300000). */
  timeoutMs?: number;
  /** Reply truncation ceiling in characters (default 2000). */
  maxReplyChars?: number;
  /** Pagination window size (default 20). */
  limit?: number;
  /** Pagination cursor: tasks to skip before running (default 0). */
  offset?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

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

const labelForTask = (task: FanoutTask, index: number): string => task.label ?? `task ${index + 1}`;

const okRow = (
  task: FanoutTask,
  reply: FanoutTaskReply,
  maxReplyChars: number,
  elapsedMs: number,
): FanoutTaskResult => {
  const truncated = reply.reply.length > maxReplyChars;
  return {
    ...(task.label ? { label: task.label } : {}),
    target: reply.target,
    ok: true,
    reply: truncated ? reply.reply.slice(0, maxReplyChars) : reply.reply,
    ...(truncated ? { truncated: true, replyChars: reply.reply.length } : {}),
    elapsedMs,
  };
};

const errRow = (task: FanoutTask, err: unknown, elapsedMs: number): FanoutTaskResult => {
  return {
    ...(task.label ? { label: task.label } : {}),
    target: null,
    ok: false,
    error: err instanceof Error ? err.message : String(err),
    elapsedMs,
  };
};

/**
 * Run an ordered array of fan-out tasks through a bounded pool and return one row per task.
 *
 * Never rejects — each task's outcome (reply, or error + elapsed) is captured independently,
 * so one slow or failed Conversation never blocks or fails the rest. At most `maxConcurrency`
 * tasks run at once (default 1); `offset`/`limit` window which tasks run and come back, so a
 * large batch cannot flood the caller's context; each reply is truncated to `maxReplyChars`.
 * The browser work is injected as `runOne`, keeping this core pure and testable.
 *
 * @param tasks - The full ordered task list; the window is sliced from it by `offset`/`limit`.
 * @param runOne - Drives one task (opens a tab, asks, captures) and returns its reply + target.
 * @param options - Concurrency, timeout, truncation, and pagination knobs.
 * @returns The windowed rows in input order plus `total`/`nextOffset` for paging.
 * @example
 * ```ts
 * const result = await runFanoutTasks(
 *   [{ prompt: "one word: BLUE" }, { prompt: "one word: RED" }],
 *   async (task) => ({ reply: "BLUE", target: { provider: "chatgpt", mode: "new", id: "c1", url: "https://chatgpt.com/c/c1", isolate: null } }),
 *   { maxConcurrency: 2 },
 * );
 * ```
 */
export const runFanoutTasks = async (
  tasks: readonly FanoutTask[],
  runOne: (task: FanoutTask, index: number) => Promise<FanoutTaskReply>,
  options: FanoutBatchOptions = {},
): Promise<FanoutBatchResult> => {
  const clock = options.now ?? (() => Date.now());
  const maxConcurrency = Math.max(
    1,
    Math.floor(options.maxConcurrency ?? DEFAULT_FANOUT_CONCURRENCY),
  );
  const maxReplyChars = Math.max(
    1,
    Math.floor(options.maxReplyChars ?? DEFAULT_FANOUT_MAX_REPLY_CHARS),
  );
  const timeoutMs = options.timeoutMs ?? DEFAULT_FANOUT_TIMEOUT_MS;
  const limit = Math.max(1, Math.floor(options.limit ?? DEFAULT_FANOUT_LIMIT));
  const total = tasks.length;
  const offset = Math.min(Math.max(0, Math.floor(options.offset ?? 0)), total);
  const windowTasks = tasks.slice(offset, offset + limit);
  const results = new Array<FanoutTaskResult>(windowTasks.length);
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
        results[localIndex] = okRow(task, reply, maxReplyChars, clock() - start);
      } catch (err) {
        results[localIndex] = errRow(task, err, clock() - start);
      }
    }
  };
  const workerCount = Math.min(maxConcurrency, windowTasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  const consumed = offset + windowTasks.length;
  return { total, offset, limit, nextOffset: consumed < total ? consumed : null, results };
};

/**
 * Whether the run should exit non-zero: no tasks at all, all tasks failed, or (strict) any failed.
 *
 * @param result - The fan-out result to judge.
 * @param strict - When true, any single failure is a failure; otherwise only an all-fail is.
 * @returns True when the batch should be treated as failed.
 * @example
 * ```ts
 * const failed = fanoutBatchFailed(result, true);
 * ```
 */
export const fanoutBatchFailed = (result: FanoutBatchResult, strict: boolean): boolean => {
  if (result.total === 0) return true;
  if (result.results.length === 0) return false;
  return strict ? result.results.some((row) => !row.ok) : result.results.every((row) => !row.ok);
};
