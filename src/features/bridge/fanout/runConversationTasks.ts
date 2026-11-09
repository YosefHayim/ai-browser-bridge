import type { FanoutTask } from "../engine/bridgeSchemas.ts";

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

const DEFAULT_FANOUT_CONCURRENCY = 1;

const DEFAULT_FANOUT_TIMEOUT_MS = 300_000;

const DEFAULT_FANOUT_MAX_REPLY_CHARS = 2_000;

const DEFAULT_FANOUT_LIMIT = 20;

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const timeoutError = new Error(`${label} timed out after ${ms}ms`);
      reject(timeoutError);
    }, ms);
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

const completedConversationTask = (
  task: FanoutTask,
  taskReply: FanoutTaskReply,
  maxReplyChars: number,
  elapsedMs: number,
): FanoutTaskResult => {
  const truncated = taskReply.reply.length > maxReplyChars;
  let replyText = taskReply.reply;
  if (truncated) replyText = taskReply.reply.slice(0, maxReplyChars);
  const conversationResult: FanoutTaskResult = {
    target: taskReply.target,
    ok: true,
    reply: replyText,
    elapsedMs,
  };
  if (task.label !== undefined) conversationResult.label = task.label;
  if (truncated) {
    conversationResult.truncated = true;
    conversationResult.replyChars = taskReply.reply.length;
  }
  return conversationResult;
};

const failedConversationTask = (
  task: FanoutTask,
  error: unknown,
  elapsedMs: number,
): FanoutTaskResult => {
  let errorMessage: string;
  if (error instanceof Error) {
    errorMessage = error.message;
  } else {
    errorMessage = String(error);
  }
  const conversationResult: FanoutTaskResult = {
    target: null,
    ok: false,
    error: errorMessage,
    elapsedMs,
  };
  if (task.label !== undefined) conversationResult.label = task.label;
  return conversationResult;
};

export const runFanoutTasks = async (
  tasks: readonly FanoutTask[],
  runConversationTask: (task: FanoutTask, index: number) => Promise<FanoutTaskReply>,
  options: FanoutOptions = {},
): Promise<FanoutResult> => {
  let clock = (): number => Date.now();
  if (options.now !== undefined) clock = options.now;

  let maxConcurrency = DEFAULT_FANOUT_CONCURRENCY;
  if (options.maxConcurrency !== undefined) maxConcurrency = options.maxConcurrency;
  maxConcurrency = Math.floor(maxConcurrency);
  maxConcurrency = Math.max(1, maxConcurrency);

  let maxReplyChars = DEFAULT_FANOUT_MAX_REPLY_CHARS;
  if (options.maxReplyChars !== undefined) maxReplyChars = options.maxReplyChars;
  maxReplyChars = Math.floor(maxReplyChars);
  maxReplyChars = Math.max(1, maxReplyChars);

  let timeoutMs = DEFAULT_FANOUT_TIMEOUT_MS;
  if (options.timeoutMs !== undefined) timeoutMs = options.timeoutMs;

  let limit = DEFAULT_FANOUT_LIMIT;
  if (options.limit !== undefined) limit = options.limit;
  limit = Math.floor(limit);
  limit = Math.max(1, limit);

  const total = tasks.length;
  let offset = 0;
  if (options.offset !== undefined) offset = Math.floor(options.offset);
  offset = Math.max(0, offset);
  offset = Math.min(offset, total);

  const selectedTasks = tasks.slice(offset, offset + limit);
  const conversationResults = new Array<FanoutTaskResult>(selectedTasks.length);
  let nextTaskIndex = 0;
  const consumePendingTasks = async (): Promise<void> => {
    while (nextTaskIndex < selectedTasks.length) {
      const localIndex = nextTaskIndex++;
      const task = selectedTasks[localIndex];
      if (task === undefined) continue;
      const globalIndex = offset + localIndex;
      const startedAt = clock();
      try {
        const replyPromise = runConversationTask(task, globalIndex);
        const taskLabel = labelForTask(task, globalIndex);
        const taskReply = await withTimeout(replyPromise, timeoutMs, taskLabel);
        const elapsedMs = clock() - startedAt;
        conversationResults[localIndex] = completedConversationTask(
          task,
          taskReply,
          maxReplyChars,
          elapsedMs,
        );
      } catch (error) {
        const elapsedMs = clock() - startedAt;
        conversationResults[localIndex] = failedConversationTask(task, error, elapsedMs);
      }
    }
  };
  const workerCount = Math.min(maxConcurrency, selectedTasks.length);
  const workers: Promise<void>[] = [];
  for (let workerIndex = 0; workerIndex < workerCount; workerIndex++) {
    const worker = consumePendingTasks();
    workers.push(worker);
  }
  await Promise.all(workers);
  const consumed = offset + selectedTasks.length;
  let nextOffset: number | null = null;
  if (consumed < total) nextOffset = consumed;
  return { total, offset, limit, nextOffset, results: conversationResults };
};

/** True when the run should exit non-zero: no tasks, all failed, or (strict) any failed. */
export const fanoutFailed = (fanout: FanoutResult, strict: boolean): boolean => {
  if (fanout.total === 0) return true;
  if (fanout.results.length === 0) return false;
  if (strict) return fanout.results.some((conversationResult) => !conversationResult.ok);
  return fanout.results.every((conversationResult) => !conversationResult.ok);
};
