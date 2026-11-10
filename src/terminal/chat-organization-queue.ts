import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { bridgeDir } from "@/store/paths.ts";

const ChatOrganizationTaskSchema = z.object({
  conversation: z.string().min(1),
  project: z.string().min(1),
});

const ChatOrganizationTasksSchema = z.array(ChatOrganizationTaskSchema).min(1);

export type ChatOrganizationTask = z.infer<typeof ChatOrganizationTaskSchema>;

const PendingQueueItemSchema = z.object({
  status: z.literal("pending"),
  conversation: z.string(),
  project: z.string(),
  attempts: z.number().int().nonnegative(),
  lastReason: z.string().optional(),
});

const CompletedQueueItemSchema = z.object({
  status: z.enum(["moved", "already-filed"]),
  conversation: z.string(),
  project: z.string(),
  attempts: z.number().int().positive(),
  completedAt: z.string(),
});

const FailedQueueItemSchema = z.object({
  status: z.literal("failed"),
  conversation: z.string(),
  project: z.string(),
  attempts: z.number().int().positive(),
  reason: z.string(),
  completedAt: z.string(),
});

const ChatOrganizationQueueItemSchema = z.union([
  PendingQueueItemSchema,
  CompletedQueueItemSchema,
  FailedQueueItemSchema,
]);

const ChatOrganizationPacingSchema = z.object({
  currentSeconds: z.number().int().positive(),
  successStreak: z.number().int().nonnegative(),
  rateLimitCount: z.number().int().nonnegative(),
});

const ChatOrganizationVerificationSchema = z.object({
  complete: z.boolean(),
  inventoryComplete: z.boolean(),
  remainingOrphans: z.number().int().nonnegative(),
  plannedStillLoose: z.array(z.string()),
  verifiedAt: z.string(),
  error: z.string().optional(),
});

const ChatOrganizationQueueSchema = z.object({
  version: z.literal(1),
  fingerprint: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  items: z.array(ChatOrganizationQueueItemSchema).min(1),
  pacing: ChatOrganizationPacingSchema.optional(),
  verification: ChatOrganizationVerificationSchema.optional(),
});

export type ChatOrganizationQueue = z.infer<typeof ChatOrganizationQueueSchema>;
type ChatOrganizationQueueItem = z.infer<typeof ChatOrganizationQueueItemSchema>;
export type ChatOrganizationPacing = z.infer<typeof ChatOrganizationPacingSchema>;
export type ChatOrganizationVerification = z.infer<typeof ChatOrganizationVerificationSchema>;
export type ChatOrganizationQueueSummary = {
  readonly total: number;
  readonly pending: number;
  readonly moved: number;
  readonly alreadyFiled: number;
  readonly failed: number;
};
export type ChatOrganizationInterval = {
  readonly minimumSeconds: number;
  readonly maximumSeconds: number;
};

const ORGANIZATION_INTERVAL = /^(?<minimum>\d+)(?:-(?<maximum>\d+))?$/u;
const CLOSED_BROWSER_SESSION =
  /(?:target page, context or browser has been closed|browser has been closed|context has been closed|page has been closed)/iu;

export const chatOrganizationSessionWasClosed = (reason: string | undefined): boolean => {
  const isReasonMissing = reason === undefined;
  if (isReasonMissing) return false;

  return CLOSED_BROWSER_SESSION.test(reason);
};

export const chatOrganizationIntervalFrom = (
  value: string | undefined,
  defaultSeconds: number,
): ChatOrganizationInterval => {
  const isValueMissing = value === undefined;
  if (isValueMissing) {
    return { minimumSeconds: defaultSeconds, maximumSeconds: defaultSeconds };
  }

  const match = ORGANIZATION_INTERVAL.exec(value.trim());
  const minimumText = match?.groups?.minimum;
  const maximumText = match?.groups?.maximum;

  const isMinimumMissing = minimumText === undefined;
  if (isMinimumMissing) {
    throw new Error("--interval must be whole seconds or a range such as 10-20.");
  }

  const minimumSeconds = Number.parseInt(minimumText, 10);
  let maximumSeconds = minimumSeconds;

  const hasMaximum = maximumText !== undefined;
  if (hasMaximum) maximumSeconds = Number.parseInt(maximumText, 10);

  const isIntervalInvalid =
    minimumSeconds <= 0 || maximumSeconds <= 0 || minimumSeconds > maximumSeconds;
  if (isIntervalInvalid) {
    throw new Error("--interval must be a positive ascending range such as 10-20.");
  }

  return { minimumSeconds, maximumSeconds };
};

export const nextChatOrganizationIntervalSeconds = (
  interval: ChatOrganizationInterval,
  randomFraction: number,
): number => {
  const hasFixedInterval = interval.minimumSeconds === interval.maximumSeconds;
  if (hasFixedInterval) return interval.minimumSeconds;

  const width = interval.maximumSeconds - interval.minimumSeconds + 1;
  return interval.minimumSeconds + Math.floor(randomFraction * width);
};

export const initialChatOrganizationPacing = (currentSeconds: number): ChatOrganizationPacing => ({
  currentSeconds,
  successStreak: 0,
  rateLimitCount: 0,
});

export const constrainChatOrganizationPacing = (
  pacing: ChatOrganizationPacing,
  options: {
    readonly minimumSeconds: number;
    readonly maximumSeconds: number;
    readonly speedUpAfter: number;
  },
): ChatOrganizationPacing => ({
  ...pacing,
  currentSeconds: Math.min(
    options.maximumSeconds,
    Math.max(options.minimumSeconds, pacing.currentSeconds),
  ),
  successStreak: Math.min(pacing.successStreak, options.speedUpAfter - 1),
});

export const adaptiveChatOrganizationPacingAfterSuccess = (
  pacing: ChatOrganizationPacing,
  options: { readonly minimumSeconds: number; readonly speedUpAfter: number },
): ChatOrganizationPacing => {
  const successStreak = pacing.successStreak + 1;
  const isBelowSpeedUpStreak = successStreak < options.speedUpAfter;
  if (isBelowSpeedUpStreak) return { ...pacing, successStreak };

  return {
    ...pacing,
    currentSeconds: Math.min(
      pacing.currentSeconds,
      Math.max(options.minimumSeconds, Math.floor(pacing.currentSeconds * 0.8)),
    ),
    successStreak: 0,
  };
};

export const adaptiveChatOrganizationPacingAfterRateLimit = (
  pacing: ChatOrganizationPacing,
  options: { readonly maximumSeconds: number },
): ChatOrganizationPacing => ({
  currentSeconds: Math.min(options.maximumSeconds, Math.ceil(pacing.currentSeconds * 1.5)),
  successStreak: 0,
  rateLimitCount: pacing.rateLimitCount + 1,
});

export const nextAdaptiveChatOrganizationIntervalSeconds = (
  pacing: ChatOrganizationPacing,
  randomFraction: number,
): number => {
  const jitter = Math.max(1, Math.ceil(pacing.currentSeconds * 0.2));
  return pacing.currentSeconds + Math.floor(randomFraction * (jitter + 1));
};

export const chatOrganizationIntervalLabel = (interval: ChatOrganizationInterval): string => {
  const hasFixedInterval = interval.minimumSeconds === interval.maximumSeconds;
  if (hasFixedInterval) return `${interval.minimumSeconds}s`;

  return `${interval.minimumSeconds}-${interval.maximumSeconds}s`;
};

const readOrganizationPlanSource = async (
  spec: string,
  launchDirectory: string,
): Promise<string> => {
  const trimmed = spec.trim();
  const isJsonArrayText = trimmed.startsWith("[");
  if (isJsonArrayText) return trimmed;

  let sourcePath = trimmed;

  const isAtMentionText = trimmed.startsWith("@");
  if (isAtMentionText) sourcePath = trimmed.slice(1);

  let absolutePath = sourcePath;

  const isNotAbsolutePath = !isAbsolute(sourcePath);
  if (isNotAbsolutePath) absolutePath = resolve(launchDirectory, sourcePath);

  return readFile(absolutePath, "utf8");
};

const normalizedOrganizationTasks = (
  tasks: readonly ChatOrganizationTask[],
): readonly ChatOrganizationTask[] => {
  const normalized: ChatOrganizationTask[] = [];
  for (const task of tasks) {
    const conversation = task.conversation.trim();
    const project = task.project.trim();

    const isConversationEmpty = !conversation;
    if (isConversationEmpty)
      throw new Error("Every organization task needs a Conversation id or title.");

    const isProjectMissing = project == null;
    if (isProjectMissing) throw new Error("Every organization task needs a Project name.");

    normalized.push({ conversation, project });
  }
  return normalized;
};

export const loadChatOrganizationTasks = async (
  spec: string,
  launchDirectory: string,
): Promise<readonly ChatOrganizationTask[]> => {
  const isSpecBlank = !spec.trim();
  if (isSpecBlank) throw new Error("--plan needs a file, @file, or inline JSON array.");

  const source = await readOrganizationPlanSource(spec, launchDirectory);
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    const isErrorObject = error instanceof Error;
    throw new Error(
      `Organization plan is not valid JSON: ${isErrorObject ? error.message : String(error)}`,
    );
  }
  const tasks = ChatOrganizationTasksSchema.parse(parsed);
  return normalizedOrganizationTasks(tasks);
};

const organizationPlanFingerprint = (tasks: readonly ChatOrganizationTask[]): string => {
  return createHash("sha256").update(JSON.stringify(tasks)).digest("hex").slice(0, 16);
};

export const chatOrganizationQueuePath = (
  repoRoot: string,
  tasks: readonly ChatOrganizationTask[],
): string => {
  return join(
    bridgeDir(repoRoot),
    "chat-organization-queues",
    `${organizationPlanFingerprint(tasks)}.json`,
  );
};

const newChatOrganizationQueue = (
  tasks: readonly ChatOrganizationTask[],
  timestamp: string,
): ChatOrganizationQueue => {
  return {
    version: 1,
    fingerprint: organizationPlanFingerprint(tasks),
    createdAt: timestamp,
    updatedAt: timestamp,
    items: tasks.map((task) => ({
      status: "pending" as const,
      conversation: task.conversation,
      project: task.project,
      attempts: 0,
    })),
  };
};

export const persistChatOrganizationQueue = async (
  queuePath: string,
  queue: ChatOrganizationQueue,
): Promise<void> => {
  await mkdir(dirname(queuePath), { recursive: true });
  const pendingPath = `${queuePath}.${process.pid}.${randomUUID()}.pending`;
  try {
    await writeFile(pendingPath, `${JSON.stringify(queue, null, 2)}\n`, "utf8");
    await rename(pendingPath, queuePath);
  } finally {
    try {
      await unlink(pendingPath);
    } catch {
      // A successful atomic rename already removed the temporary path.
    }
  }
};

export const updateChatOrganizationQueuePacing = (input: {
  readonly queue: ChatOrganizationQueue;
  readonly pacing: ChatOrganizationPacing;
  readonly timestamp: string;
}): ChatOrganizationQueue => ({
  ...input.queue,
  pacing: input.pacing,
  updatedAt: input.timestamp,
});

export const updateChatOrganizationQueueVerification = (input: {
  readonly queue: ChatOrganizationQueue;
  readonly verification: ChatOrganizationVerification;
  readonly timestamp: string;
}): ChatOrganizationQueue => ({
  ...input.queue,
  verification: input.verification,
  updatedAt: input.timestamp,
});

const errorCodeOf = (error: unknown): string | undefined => {
  const hasNoErrorCode = typeof error !== "object" || error === null || !("code" in error);
  if (hasNoErrorCode) return undefined;

  const isErrorCodeTypeNotString = typeof error.code !== "string";
  if (isErrorCodeTypeNotString) return undefined;

  return error.code;
};

const chatOrganizationPausePath = (queuePath: string): string => `${queuePath}.pause`;

export const chatOrganizationQueueIsPaused = async (queuePath: string): Promise<boolean> =>
  existsSync(chatOrganizationPausePath(queuePath));

export const pauseChatOrganizationQueue = async (
  queuePath: string,
  timestamp: string,
): Promise<void> => {
  await mkdir(dirname(queuePath), { recursive: true });
  await writeFile(
    chatOrganizationPausePath(queuePath),
    `${JSON.stringify({ pausedAt: timestamp })}\n`,
    "utf8",
  );
};

export const clearChatOrganizationQueuePause = async (queuePath: string): Promise<void> => {
  try {
    await unlink(chatOrganizationPausePath(queuePath));
  } catch (error) {
    const isErrorNotMissingFile = errorCodeOf(error) !== "ENOENT";
    if (isErrorNotMissingFile) throw error;
  }
};

const organizationQueueIsRunning = async (
  queuePath: string,
): Promise<{ readonly running: boolean; readonly ownerPid?: number }> => {
  let owner: unknown;
  try {
    owner = JSON.parse(await readFile(`${queuePath}.lock`, "utf8"));
  } catch {
    return { running: false };
  }

  if (typeof owner !== "object" || owner === null || !("pid" in owner)) {
    return { running: false };
  }

  const isOwnerPidInvalid = typeof owner.pid !== "number" || !Number.isInteger(owner.pid);
  if (isOwnerPidInvalid) return { running: false };

  try {
    process.kill(owner.pid, 0);
    return { running: true, ownerPid: owner.pid };
  } catch (error) {
    const isProcessGone = errorCodeOf(error) === "ESRCH";
    if (isProcessGone) return { running: false, ownerPid: owner.pid };

    return { running: true, ownerPid: owner.pid };
  }
};

export type ResolvedChatOrganizationQueue = {
  readonly path: string;
  readonly queue: ChatOrganizationQueue;
  readonly paused: boolean;
  readonly running: boolean;
  readonly ownerPid?: number;
};

const readChatOrganizationQueue = async (queuePath: string): Promise<ChatOrganizationQueue> => {
  const stored: unknown = JSON.parse(await readFile(queuePath, "utf8"));
  return ChatOrganizationQueueSchema.parse(stored);
};

export const resolveChatOrganizationQueue = async (
  repoRoot: string,
  selector?: string,
): Promise<ResolvedChatOrganizationQueue> => {
  const queueDirectory = join(bridgeDir(repoRoot), "chat-organization-queues");
  let queuePath: string | undefined;

  const hasSelector = selector?.trim();
  if (hasSelector) {
    const trimmed = selector.trim();
    const isNotSimpleName = isAbsolute(trimmed) || trimmed.includes("/");
    const isTrimmedEndsWith = trimmed.endsWith(".json");
    if (isNotSimpleName) queuePath = resolve(repoRoot, trimmed);
    else queuePath = join(queueDirectory, isTrimmedEndsWith ? trimmed : `${trimmed}.json`);
  } else {
    let names: string[];
    try {
      names = (await readdir(queueDirectory)).filter((name) => /^[a-f0-9]{16}\.json$/u.test(name));
    } catch (error) {
      const isMissingFileError = errorCodeOf(error) === "ENOENT";
      if (isMissingFileError) names = [];
      else throw error;
    }
    const queues = await Promise.all(
      names.map(async (name) => {
        const path = join(queueDirectory, name);
        return { path, queue: await readChatOrganizationQueue(path) };
      }),
    );
    queues.sort((left, right) => right.queue.updatedAt.localeCompare(left.queue.updatedAt));
    queuePath = queues[0]?.path;
  }

  if (queuePath === undefined || !existsSync(queuePath)) {
    throw new Error("No persisted ChatGPT organization queue was found.");
  }

  const queue = await readChatOrganizationQueue(queuePath);
  const ownership = await organizationQueueIsRunning(queuePath);
  return {
    path: queuePath,
    queue,
    paused: await chatOrganizationQueueIsPaused(queuePath),
    ...ownership,
  };
};

const removeStaleQueueLock = async (lockPath: string): Promise<boolean> => {
  let owner: unknown;
  try {
    owner = JSON.parse(await readFile(lockPath, "utf8"));
  } catch {
    return false;
  }

  if (typeof owner !== "object" || owner === null || !("pid" in owner)) return false;

  const isOwnerPidInvalid = typeof owner.pid !== "number" || !Number.isInteger(owner.pid);
  if (isOwnerPidInvalid) return false;

  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    const isNotNoSuchProcess = errorCodeOf(error) !== "ESRCH";
    if (isNotNoSuchProcess) return false;
  }
  await unlink(lockPath);
  return true;
};

export const acquireChatOrganizationQueueLock = async (
  queuePath: string,
): Promise<() => Promise<void>> => {
  await mkdir(dirname(queuePath), { recursive: true });
  const lockPath = `${queuePath}.lock`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(
        `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`,
      );
      let released = false;
      return async () => {
        if (released) return;

        released = true;
        await handle.close();
        await unlink(lockPath);
      };
    } catch (error) {
      const isNotAlreadyExists = errorCodeOf(error) !== "EEXIST";
      if (isNotAlreadyExists) throw error;

      const hasRemovedStaleLock = attempt === 0 && (await removeStaleQueueLock(lockPath));
      if (hasRemovedStaleLock) continue;

      throw new Error(`Organization queue is already running: ${lockPath}`);
    }
  }
  throw new Error(`Could not acquire organization queue lock: ${lockPath}`);
};

export const openChatOrganizationQueue = async (input: {
  readonly repoRoot: string;
  readonly tasks: readonly ChatOrganizationTask[];
  readonly restart: boolean;
  readonly timestamp: string;
}): Promise<{ readonly path: string; readonly queue: ChatOrganizationQueue }> => {
  const path = chatOrganizationQueuePath(input.repoRoot, input.tasks);
  const isLockHeld = !input.restart && existsSync(path);
  if (isLockHeld) {
    const stored: unknown = JSON.parse(await readFile(path, "utf8"));
    const queue = ChatOrganizationQueueSchema.parse(stored);

    const expectedFingerprint = organizationPlanFingerprint(input.tasks);
    const isFingerprintChanged = queue.fingerprint !== expectedFingerprint;
    if (isFingerprintChanged) {
      throw new Error(`Stored queue fingerprint does not match ${path}. Use --restart.`);
    }

    return { path, queue };
  }

  const queue = newChatOrganizationQueue(input.tasks, input.timestamp);
  await persistChatOrganizationQueue(path, queue);
  return { path, queue };
};

export const nextChatOrganizationQueueIndex = (
  queue: ChatOrganizationQueue,
): number | undefined => {
  const index = queue.items.findIndex((item) => item.status === "pending");
  const isIndexNotFound = index < 0;
  if (isIndexNotFound) return undefined;

  return index;
};

export const completeChatOrganizationQueueItem = (input: {
  readonly queue: ChatOrganizationQueue;
  readonly index: number;
  readonly status: "moved" | "already-filed";
  readonly timestamp: string;
}): ChatOrganizationQueue => {
  const current = input.queue.items[input.index];
  const isCurrentNotPending = current === undefined || current.status !== "pending";
  if (isCurrentNotPending) return input.queue;

  const items = [...input.queue.items];
  items[input.index] = {
    status: input.status,
    conversation: current.conversation,
    project: current.project,
    attempts: current.attempts + 1,
    completedAt: input.timestamp,
  };
  return { ...input.queue, updatedAt: input.timestamp, items };
};

export const deferChatOrganizationQueueItem = (input: {
  readonly queue: ChatOrganizationQueue;
  readonly index: number;
  readonly reason: string;
  readonly timestamp: string;
}): ChatOrganizationQueue => {
  const current = input.queue.items[input.index];
  const isCurrentNotPending = current === undefined || current.status !== "pending";
  if (isCurrentNotPending) return input.queue;

  const items = [...input.queue.items];
  items[input.index] = {
    status: "pending",
    conversation: current.conversation,
    project: current.project,
    attempts: current.attempts,
    lastReason: input.reason,
  };
  return { ...input.queue, updatedAt: input.timestamp, items };
};

export const failChatOrganizationQueueItem = (input: {
  readonly queue: ChatOrganizationQueue;
  readonly index: number;
  readonly reason: string;
  readonly maxAttempts: number;
  readonly timestamp: string;
}): ChatOrganizationQueue => {
  const current = input.queue.items[input.index];
  const isCurrentNotPending = current === undefined || current.status !== "pending";
  if (isCurrentNotPending) return input.queue;

  const attempts = current.attempts + 1;
  const items = [...input.queue.items];

  const isAttemptsAtLeastMaxAttempts = attempts >= input.maxAttempts;
  if (isAttemptsAtLeastMaxAttempts) {
    items[input.index] = {
      status: "failed",
      conversation: current.conversation,
      project: current.project,
      attempts,
      reason: input.reason,
      completedAt: input.timestamp,
    };
  } else {
    items[input.index] = {
      status: "pending",
      conversation: current.conversation,
      project: current.project,
      attempts,
      lastReason: input.reason,
    };
  }

  return { ...input.queue, updatedAt: input.timestamp, items };
};

export const summarizeChatOrganizationQueue = (
  queue: ChatOrganizationQueue,
): ChatOrganizationQueueSummary => {
  const summary = {
    total: queue.items.length,
    pending: 0,
    moved: 0,
    alreadyFiled: 0,
    failed: 0,
  };
  for (const item of queue.items) {
    const isStatusPending = item.status === "pending";
    if (isStatusPending) summary.pending += 1;
    else if (item.status === "moved") summary.moved += 1;
    else if (item.status === "already-filed") summary.alreadyFiled += 1;
    else summary.failed += 1;
  }
  return summary;
};

const conversationIdentity = (value: string): string => {
  const trimmed = value.trim();
  const conversationPath = /\/c\/(?<id>[^/?#]+)/u.exec(trimmed)?.groups?.id;

  const hasConversationPath = conversationPath !== undefined;
  if (hasConversationPath) return conversationPath;

  return trimmed;
};

export const reopenChatOrganizationQueueItems = (input: {
  readonly queue: ChatOrganizationQueue;
  readonly conversations: readonly string[];
  readonly maxAttempts: number;
  readonly timestamp: string;
}): ChatOrganizationQueue => {
  const targets = new Set(input.conversations.map(conversationIdentity));
  let changed = false;
  const items = input.queue.items.map((item) => {
    const isItemSkipped =
      (item.status !== "moved" && item.status !== "already-filed") ||
      item.attempts >= input.maxAttempts ||
      !targets.has(conversationIdentity(item.conversation));
    if (isItemSkipped) {
      return item;
    }

    changed = true;
    return {
      status: "pending" as const,
      conversation: item.conversation,
      project: item.project,
      attempts: item.attempts,
      lastReason: "Full-history audit found the Conversation still loose.",
    };
  });

  const isNotChanged = !changed;
  if (isNotChanged) return input.queue;

  return { ...input.queue, items, updatedAt: input.timestamp };
};

export const chatOrganizationVerificationFrom = (input: {
  readonly queue: ChatOrganizationQueue;
  readonly orphans: readonly { readonly id: string; readonly title: string }[];
  readonly timestamp: string;
}): ChatOrganizationVerification => {
  const orphanIdentities = new Set<string>();
  for (const orphan of input.orphans) {
    orphanIdentities.add(conversationIdentity(orphan.id));
    orphanIdentities.add(orphan.title.trim());
  }
  const plannedStillLoose = input.queue.items
    .filter((item) => orphanIdentities.has(conversationIdentity(item.conversation)))
    .map((item) => item.conversation);
  const summary = summarizeChatOrganizationQueue(input.queue);
  return {
    complete: summary.pending === 0 && summary.failed === 0 && plannedStillLoose.length === 0,
    inventoryComplete: true,
    remainingOrphans: input.orphans.length,
    plannedStillLoose,
    verifiedAt: input.timestamp,
  };
};
