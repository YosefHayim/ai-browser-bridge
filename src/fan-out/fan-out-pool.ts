import type { FanOutTask } from "@/bridge-engine/bridge-schemas.ts";
import { readErrorMessage } from "@/read-error-message.ts";

const DEFAULT_FAN_OUT_CONCURRENCY = 1;
const DEFAULT_FAN_OUT_TIMEOUT_MILLISECONDS = 300_000;
const DEFAULT_FAN_OUT_MAX_REPLY_CHARS = 2_000;
const DEFAULT_FAN_OUT_LIMIT = 20;

export interface FanOutConversation {
  provider: string;
  mode: "new" | "existing";
  id: string | null;
  url: string | null;
  isolate: string | null;
}

export interface FanOutConversationReply {
  reply: string;
  target: FanOutConversation;
}

export interface FanOutRow {
  label?: string;
  target: FanOutConversation | null;
  ok: boolean;
  reply?: string;
  truncated?: boolean;
  replyChars?: number;
  error?: string;
  elapsedMs: number;
}

export interface FanOutReport {
  total: number;
  offset: number;
  limit: number;
  nextOffset: number | null;
  taskReports: FanOutRow[];
}

export interface FanOutSettings {
  maxConcurrency?: number;
  timeoutMilliseconds?: number;
  maxReplyChars?: number;
  limit?: number;
  offset?: number;
  now?: () => number;
}

async function raceWithTimeout<Reply>(
  promise: Promise<Reply>,
  milliseconds: number,
  label: string,
): Promise<Reply> {
  const timeoutSignal = AbortSignal.timeout(milliseconds);

  function rejectAtTimeout(_fulfill: unknown, reject: (reason: Error) => void): void {
    function rejectWithTimeoutError(): void {
      reject(new Error(`${label} timed out after ${milliseconds}ms`));
    }

    timeoutSignal.addEventListener("abort", rejectWithTimeoutError, { once: true });
  }

  const timeoutFailure = new Promise<never>(rejectAtTimeout);

  return Promise.race([promise, timeoutFailure]);
}

function readTaskLabel(task: FanOutTask, index: number): string {
  return task.label ?? `task ${index + 1}`;
}

function readWholeAtLeast(value: number, minimum: number): number {
  const wholeValue = Math.floor(value);
  return Math.max(minimum, wholeValue);
}

function readNextOffset(consumed: number, total: number): number | null {
  const hasUnconsumedTasks = consumed < total;
  if (hasUnconsumedTasks) return consumed;

  return null;
}

interface SuccessfulRowDetails {
  task: FanOutTask;
  conversationReply: FanOutConversationReply;
  maxReplyChars: number;
  elapsedMs: number;
}

function readSuccessfulRow({
  task,
  conversationReply,
  maxReplyChars,
  elapsedMs,
}: SuccessfulRowDetails): FanOutRow {
  const isTruncated = conversationReply.reply.length > maxReplyChars;
  const reply = isTruncated
    ? conversationReply.reply.slice(0, maxReplyChars)
    : conversationReply.reply;

  const row: FanOutRow = {
    target: conversationReply.target,
    ok: true,
    reply,
    elapsedMs,
  };

  const hasTaskLabel = task.label != null;
  if (hasTaskLabel) row.label = task.label;

  if (isTruncated) {
    row.truncated = true;
    row.replyChars = conversationReply.reply.length;
  }

  return row;
}

function createFailedRow(task: FanOutTask, error: unknown, elapsedMs: number): FanOutRow {
  const errorMessage = readErrorMessage(error);

  const row: FanOutRow = {
    target: null,
    ok: false,
    error: errorMessage,
    elapsedMs,
  };

  const hasTaskLabel = task.label != null;
  if (hasTaskLabel) row.label = task.label;

  return row;
}

function isFailedRow(row: FanOutRow): boolean {
  return !row.ok;
}

export async function runFanOutTasks(
  tasks: readonly FanOutTask[],
  runOne: (task: FanOutTask, index: number) => Promise<FanOutConversationReply>,
  settings: FanOutSettings = {},
): Promise<FanOutReport> {
  const readClock = settings.now ?? Date.now;
  const maxConcurrency = readWholeAtLeast(
    settings.maxConcurrency ?? DEFAULT_FAN_OUT_CONCURRENCY,
    1,
  );
  const maxReplyChars = readWholeAtLeast(
    settings.maxReplyChars ?? DEFAULT_FAN_OUT_MAX_REPLY_CHARS,
    1,
  );
  const timeoutMilliseconds = settings.timeoutMilliseconds ?? DEFAULT_FAN_OUT_TIMEOUT_MILLISECONDS;
  const limit = readWholeAtLeast(settings.limit ?? DEFAULT_FAN_OUT_LIMIT, 1);

  const total = tasks.length;
  const nonNegativeOffset = readWholeAtLeast(settings.offset ?? 0, 0);
  const offset = Math.min(nonNegativeOffset, total);

  const windowTasks = tasks.slice(offset, offset + limit);
  const rows = new Array<FanOutRow>(windowTasks.length);
  const nextTaskIndex = { value: 0 };

  async function runWorker(): Promise<void> {
    while (nextTaskIndex.value < windowTasks.length) {
      const localIndex = nextTaskIndex.value;
      nextTaskIndex.value += 1;
      const task = windowTasks[localIndex];

      const isTaskMissing = task == null;
      if (isTaskMissing) continue;

      const globalIndex = offset + localIndex;
      const startedAt = readClock();
      try {
        const conversationReply = await raceWithTimeout(
          runOne(task, globalIndex),
          timeoutMilliseconds,
          readTaskLabel(task, globalIndex),
        );
        rows[localIndex] = readSuccessfulRow({
          task,
          conversationReply,
          maxReplyChars,
          elapsedMs: readClock() - startedAt,
        });
      } catch (error) {
        rows[localIndex] = createFailedRow(task, error, readClock() - startedAt);
      }
    }
  }

  const workerCount = Math.min(maxConcurrency, windowTasks.length);
  const workers = Array.from({ length: workerCount }, runWorker);
  await Promise.all(workers);

  const nextOffset = readNextOffset(offset + windowTasks.length, total);

  return { total, offset, limit, nextOffset, taskReports: rows };
}

export function isFanOutFailed(fanOut: FanOutReport, isStrict: boolean): boolean {
  const hasNoTasks = fanOut.total === 0;
  if (hasNoTasks) return true;

  const hasNoReports = fanOut.taskReports.length === 0;
  if (hasNoReports) return false;

  if (isStrict) return fanOut.taskReports.some(isFailedRow);

  return fanOut.taskReports.every(isFailedRow);
}
