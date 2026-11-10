import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { readBridgeDirectory } from "@/store/paths.ts";
import { readCliFailureMessage } from "./cli-failure.ts";

const DECIMAL_RADIX = 10;

const UTF8_ENCODING = "utf8";
const PENDING_STATUS = "pending" as const;
const MOVED_STATUS = "moved";
const FAILED_STATUS = "failed";
const QUEUE_FOLDER_NAME = "chat-organization-queues";
const ALREADY_FILED_STATUS = "already-filed";
const NO_SUCH_PROCESS_ERROR_CODE = "ESRCH";
const MISSING_FILE_ERROR_CODE = "ENOENT";

const ChatOrganizationTaskSchema = z.object({
  conversation: z.string().min(1),
  project: z.string().min(1),
});

const ChatOrganizationTasksSchema = z.array(ChatOrganizationTaskSchema).min(1);

export type ChatOrganizationTask = z.infer<typeof ChatOrganizationTaskSchema>;

const PendingQueueElementSchema = z.object({
  status: z.literal(PENDING_STATUS),
  conversation: z.string(),
  project: z.string(),
  attempts: z.number().int().nonnegative(),
  lastReason: z.string().optional(),
});

const CompletedQueueElementSchema = z.object({
  status: z.enum([MOVED_STATUS, ALREADY_FILED_STATUS]),
  conversation: z.string(),
  project: z.string(),
  attempts: z.number().int().positive(),
  completedAt: z.string(),
});

const FailedQueueElementSchema = z.object({
  status: z.literal(FAILED_STATUS),
  conversation: z.string(),
  project: z.string(),
  attempts: z.number().int().positive(),
  reason: z.string(),
  completedAt: z.string(),
});

const ChatOrganizationQueueElementSchema = z.union([
  PendingQueueElementSchema,
  CompletedQueueElementSchema,
  FailedQueueElementSchema,
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
  items: z.array(ChatOrganizationQueueElementSchema).min(1),
  pacing: ChatOrganizationPacingSchema.optional(),
  verification: ChatOrganizationVerificationSchema.optional(),
});

export type ChatOrganizationQueue = z.infer<typeof ChatOrganizationQueueSchema>;
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

export const isChatOrganizationSessionClosed = (reason: string | undefined): boolean => {
  const isReasonMissing = reason == null;
  if (isReasonMissing) return false;

  return /(?:target page, context or browser has been closed|browser has been closed|context has been closed|page has been closed)/iu.test(
    reason,
  );
};

export const readChatOrganizationInterval = (
  flagArgument: string | undefined,
  defaultSeconds: number,
): ChatOrganizationInterval => {
  const isFlagArgumentMissing = flagArgument == null;
  if (isFlagArgumentMissing) {
    return { minimumSeconds: defaultSeconds, maximumSeconds: defaultSeconds };
  }

  const intervalParts = /^(?<minimum>\d+)(?:-(?<maximum>\d+))?$/u.exec(flagArgument.trim());
  const minimumString = intervalParts?.groups?.minimum;
  const maximumString = intervalParts?.groups?.maximum;

  const isMinimumMissing = minimumString == null;
  if (isMinimumMissing) {
    throw new Error("--interval must be whole seconds or a range such as 10-20.");
  }

  const minimumSeconds = Number.parseInt(minimumString, DECIMAL_RADIX);
  let maximumSeconds = minimumSeconds;

  const hasMaximum = maximumString != null;
  if (hasMaximum) maximumSeconds = Number.parseInt(maximumString, DECIMAL_RADIX);

  const isIntervalInvalid =
    minimumSeconds <= 0 || maximumSeconds <= 0 || minimumSeconds > maximumSeconds;
  if (isIntervalInvalid) {
    throw new Error("--interval must be a positive ascending range such as 10-20.");
  }

  return { minimumSeconds, maximumSeconds };
};

export const pickNextChatOrganizationIntervalSeconds = (
  interval: ChatOrganizationInterval,
  randomFraction: number,
): number => {
  const hasFixedInterval = interval.minimumSeconds === interval.maximumSeconds;
  if (hasFixedInterval) return interval.minimumSeconds;

  const width = interval.maximumSeconds - interval.minimumSeconds + 1;
  return interval.minimumSeconds + Math.floor(randomFraction * width);
};

export const createInitialChatOrganizationPacing = (
  currentSeconds: number,
): ChatOrganizationPacing => ({
  currentSeconds,
  successStreak: 0,
  rateLimitCount: 0,
});

export const clampChatOrganizationPacing = (
  pacing: ChatOrganizationPacing,
  settings: {
    readonly minimumSeconds: number;
    readonly maximumSeconds: number;
    readonly speedUpAfter: number;
  },
): ChatOrganizationPacing => ({
  ...pacing,
  currentSeconds: Math.min(
    settings.maximumSeconds,
    Math.max(settings.minimumSeconds, pacing.currentSeconds),
  ),
  successStreak: Math.min(pacing.successStreak, settings.speedUpAfter - 1),
});

export const speedUpPacingAfterSuccess = (
  pacing: ChatOrganizationPacing,
  settings: { readonly minimumSeconds: number; readonly speedUpAfter: number },
): ChatOrganizationPacing => {
  const successStreak = pacing.successStreak + 1;

  const isBelowSpeedUpStreak = successStreak < settings.speedUpAfter;
  if (isBelowSpeedUpStreak) return { ...pacing, successStreak };

  const speedUpPacingFactor = 0.8;

  return {
    ...pacing,
    currentSeconds: Math.min(
      pacing.currentSeconds,
      Math.max(settings.minimumSeconds, Math.floor(pacing.currentSeconds * speedUpPacingFactor)),
    ),
    successStreak: 0,
  };
};

const slowDownPacingFactor = 1.5;

export const slowDownPacingAfterRateLimit = (
  pacing: ChatOrganizationPacing,
  settings: { readonly maximumSeconds: number },
): ChatOrganizationPacing => ({
  currentSeconds: Math.min(
    settings.maximumSeconds,
    Math.ceil(pacing.currentSeconds * slowDownPacingFactor),
  ),
  successStreak: 0,
  rateLimitCount: pacing.rateLimitCount + 1,
});

export const pickNextAdaptiveChatOrganizationIntervalSeconds = (
  pacing: ChatOrganizationPacing,
  randomFraction: number,
): number => {
  const pacingJitterFraction = 0.2;

  const jitter = Math.max(1, Math.ceil(pacing.currentSeconds * pacingJitterFraction));
  return pacing.currentSeconds + Math.floor(randomFraction * (jitter + 1));
};

export const readChatOrganizationIntervalLabel = (interval: ChatOrganizationInterval): string => {
  const hasFixedInterval = interval.minimumSeconds === interval.maximumSeconds;
  if (hasFixedInterval) return `${interval.minimumSeconds}s`;

  return `${interval.minimumSeconds}-${interval.maximumSeconds}s`;
};

const readOrganizationPlanOrigin = async (
  spec: string,
  launchDirectory: string,
): Promise<string> => {
  const trimmed = spec.trim();

  const isArrayNotation = trimmed.startsWith("[");
  if (isArrayNotation) return trimmed;

  let originPath = trimmed;

  const isAtMentionString = trimmed.startsWith("@");
  if (isAtMentionString) originPath = trimmed.slice(1);

  let absolutePath = originPath;

  const isNotAbsolutePath = !isAbsolute(originPath);
  if (isNotAbsolutePath) absolutePath = resolve(launchDirectory, originPath);

  return readFile(absolutePath, UTF8_ENCODING);
};

const listNormalizedOrganizationTasks = (
  tasks: readonly ChatOrganizationTask[],
): readonly ChatOrganizationTask[] => {
  const normalized: ChatOrganizationTask[] = [];
  for (const task of tasks) {
    const conversation = task.conversation.trim();
    const project = task.project.trim();

    const isConversationEmpty = !conversation;
    if (isConversationEmpty)
      throw new Error("Every organization task needs a Conversation id or title.");

    const isProjectEmpty = project === "";
    if (isProjectEmpty) throw new Error("Every organization task needs a Project name.");

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

  const code = await readOrganizationPlanOrigin(spec, launchDirectory);
  let parsed: unknown;
  try {
    parsed = JSON.parse(code);
  } catch (error) {
    throw new Error(`Organization plan is not valid JSON: ${readCliFailureMessage(error)}`);
  }
  const tasks = ChatOrganizationTasksSchema.parse(parsed);
  return listNormalizedOrganizationTasks(tasks);
};

const readOrganizationPlanFingerprint = (tasks: readonly ChatOrganizationTask[]): string => {
  const shortHashLength = 16;

  return createHash("sha256").update(JSON.stringify(tasks)).digest("hex").slice(0, shortHashLength);
};

export const readChatOrganizationQueuePath = (
  repoRoot: string,
  tasks: readonly ChatOrganizationTask[],
): string => {
  return join(
    readBridgeDirectory(repoRoot),
    QUEUE_FOLDER_NAME,
    `${readOrganizationPlanFingerprint(tasks)}.json`,
  );
};

const createChatOrganizationQueue = (
  tasks: readonly ChatOrganizationTask[],
  timestamp: string,
): ChatOrganizationQueue => {
  return {
    version: 1,
    fingerprint: readOrganizationPlanFingerprint(tasks),
    createdAt: timestamp,
    updatedAt: timestamp,
    items: tasks.map((task) => ({
      status: PENDING_STATUS,
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
    const prettyPrintSpaces = 2;

    await writeFile(
      pendingPath,
      `${JSON.stringify(queue, null, prettyPrintSpaces)}\n`,
      UTF8_ENCODING,
    );
    await rename(pendingPath, queuePath);
  } finally {
    try {
      await unlink(pendingPath);
    } catch {
      // A successful atomic rename already removed the temporary path.
    }
  }
};

export const updateChatOrganizationQueuePacing = (details: {
  readonly queue: ChatOrganizationQueue;
  readonly pacing: ChatOrganizationPacing;
  readonly timestamp: string;
}): ChatOrganizationQueue => ({
  ...details.queue,
  pacing: details.pacing,
  updatedAt: details.timestamp,
});

export const updateChatOrganizationQueueVerification = (details: {
  readonly queue: ChatOrganizationQueue;
  readonly verification: ChatOrganizationVerification;
  readonly timestamp: string;
}): ChatOrganizationQueue => ({
  ...details.queue,
  verification: details.verification,
  updatedAt: details.timestamp,
});

const isPlainObject = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" && candidate !== null;

const readErrorCode = (error: unknown): string | null => {
  const isErrorNotObject = !isPlainObject(error);
  if (isErrorNotObject) return null;

  const errorCode = error.code;

  const isErrorCodeTypeNotString = typeof errorCode !== "string";
  if (isErrorCodeTypeNotString) return null;

  return errorCode;
};

const readChatOrganizationPausePath = (queuePath: string): string => `${queuePath}.pause`;

export const isChatOrganizationQueuePaused = async (queuePath: string): Promise<boolean> =>
  existsSync(readChatOrganizationPausePath(queuePath));

export const pauseChatOrganizationQueue = async (
  queuePath: string,
  timestamp: string,
): Promise<void> => {
  await mkdir(dirname(queuePath), { recursive: true });
  await writeFile(
    readChatOrganizationPausePath(queuePath),
    `${JSON.stringify({ pausedAt: timestamp })}\n`,
    UTF8_ENCODING,
  );
};

export const clearChatOrganizationQueuePause = async (queuePath: string): Promise<void> => {
  try {
    await unlink(readChatOrganizationPausePath(queuePath));
  } catch (error) {
    const isErrorNotMissingFile = readErrorCode(error) !== MISSING_FILE_ERROR_CODE;
    if (isErrorNotMissingFile) throw error;
  }
};

const readParsedQueueLock = async (lockPath: string): Promise<unknown> => {
  try {
    const serializedLock = await readFile(lockPath, UTF8_ENCODING);
    const parsedLock: unknown = JSON.parse(serializedLock);
    return parsedLock;
  } catch {
    return null;
  }
};

const readQueueLockPid = async (lockPath: string): Promise<number | null> => {
  const lockOwner = await readParsedQueueLock(lockPath);

  const isLockOwnerNotObject = !isPlainObject(lockOwner);
  if (isLockOwnerNotObject) return null;

  const ownerPid = lockOwner.pid;

  const isOwnerPidInvalid = typeof ownerPid !== "number" || !Number.isInteger(ownerPid);
  if (isOwnerPidInvalid) return null;

  return ownerPid;
};

const isOrganizationQueueRunning = async (
  queuePath: string,
): Promise<{ readonly running: boolean; readonly ownerPid?: number }> => {
  const ownerPid = await readQueueLockPid(`${queuePath}.lock`);

  const isOwnerPidMissing = ownerPid == null;
  if (isOwnerPidMissing) return { running: false };

  try {
    process.kill(ownerPid, 0);
    return { running: true, ownerPid };
  } catch (error) {
    const isProcessGone = readErrorCode(error) === NO_SUCH_PROCESS_ERROR_CODE;
    if (isProcessGone) return { running: false, ownerPid };

    return { running: true, ownerPid };
  }
};

export type ChatOrganizationQueueSnapshot = {
  readonly path: string;
  readonly queue: ChatOrganizationQueue;
  readonly paused: boolean;
  readonly running: boolean;
  readonly ownerPid?: number;
};

const readChatOrganizationQueue = async (queuePath: string): Promise<ChatOrganizationQueue> => {
  const stored: unknown = JSON.parse(await readFile(queuePath, UTF8_ENCODING));
  return ChatOrganizationQueueSchema.parse(stored);
};

const pickChatOrganizationQueuePath = async (
  repoRoot: string,
  selector?: string,
): Promise<string | null> => {
  const queueDirectory = join(readBridgeDirectory(repoRoot), QUEUE_FOLDER_NAME);

  const trimmedSelector = selector?.trim();

  const hasSelector = trimmedSelector != null && trimmedSelector !== "";
  if (hasSelector) {
    const isNotSimpleName = isAbsolute(trimmedSelector) || trimmedSelector.includes("/");
    const isTrimmedEndsWith = trimmedSelector.endsWith(".json");
    const selectorFileName = isTrimmedEndsWith ? trimmedSelector : `${trimmedSelector}.json`;

    if (isNotSimpleName) return resolve(repoRoot, trimmedSelector);
    return join(queueDirectory, selectorFileName);
  }

  let names: string[];
  try {
    names = (await readdir(queueDirectory)).filter((name) => /^[a-f0-9]{16}\.json$/u.test(name));
  } catch (error) {
    const isMissingFileError = readErrorCode(error) === MISSING_FILE_ERROR_CODE;
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
  return queues[0]?.path ?? null;
};

export const findChatOrganizationQueue = async (
  repoRoot: string,
  selector?: string,
): Promise<ChatOrganizationQueueSnapshot> => {
  const queuePath = await pickChatOrganizationQueuePath(repoRoot, selector);

  const isQueueFileMissing = queuePath == null || !existsSync(queuePath);
  if (isQueueFileMissing) {
    throw new Error("No persisted ChatGPT organization queue was found.");
  }

  const queue = await readChatOrganizationQueue(queuePath);
  const ownership = await isOrganizationQueueRunning(queuePath);
  return {
    path: queuePath,
    queue,
    paused: await isChatOrganizationQueuePaused(queuePath),
    ...ownership,
  };
};

const removeStaleQueueLock = async (lockPath: string): Promise<boolean> => {
  const ownerPid = await readQueueLockPid(lockPath);

  const isOwnerPidMissing = ownerPid == null;
  if (isOwnerPidMissing) return false;

  try {
    process.kill(ownerPid, 0);
    return false;
  } catch (error) {
    const isNotNoSuchProcess = readErrorCode(error) !== NO_SUCH_PROCESS_ERROR_CODE;
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
  const lockAttemptCount = 2;

  for (let attempt = 0; attempt < lockAttemptCount; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(
        `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`,
      );
      let isReleased = false;
      return async () => {
        if (isReleased) return;

        isReleased = true;
        await handle.close();
        await unlink(lockPath);
      };
    } catch (error) {
      const isNotAlreadyExists = readErrorCode(error) !== "EEXIST";
      if (isNotAlreadyExists) throw error;

      const hasRemovedStaleLock = attempt === 0 && (await removeStaleQueueLock(lockPath));
      if (hasRemovedStaleLock) continue;

      throw new Error(`Organization queue is already running: ${lockPath}`);
    }
  }
  throw new Error(`Could not acquire organization queue lock: ${lockPath}`);
};

export const openChatOrganizationQueue = async (details: {
  readonly repoRoot: string;
  readonly tasks: readonly ChatOrganizationTask[];
  readonly restart: boolean;
  readonly timestamp: string;
}): Promise<{ readonly path: string; readonly queue: ChatOrganizationQueue }> => {
  const path = readChatOrganizationQueuePath(details.repoRoot, details.tasks);

  const isLockHeld = !details.restart && existsSync(path);
  if (isLockHeld) {
    const stored: unknown = JSON.parse(await readFile(path, UTF8_ENCODING));
    const queue = ChatOrganizationQueueSchema.parse(stored);

    const expectedFingerprint = readOrganizationPlanFingerprint(details.tasks);

    const isFingerprintChanged = queue.fingerprint !== expectedFingerprint;
    if (isFingerprintChanged) {
      throw new Error(`Stored queue fingerprint does not match ${path}. Use --restart.`);
    }

    return { path, queue };
  }

  const queue = createChatOrganizationQueue(details.tasks, details.timestamp);
  await persistChatOrganizationQueue(path, queue);
  return { path, queue };
};

export const findNextChatOrganizationQueueIndex = (queue: ChatOrganizationQueue): number | null => {
  const index = queue.items.findIndex((element) => element.status === PENDING_STATUS);

  const isIndexNotFound = index < 0;
  if (isIndexNotFound) return null;

  return index;
};

export const completeChatOrganizationQueueElement = (details: {
  readonly queue: ChatOrganizationQueue;
  readonly index: number;
  readonly status: "moved" | "already-filed";
  readonly timestamp: string;
}): ChatOrganizationQueue => {
  const current = details.queue.items[details.index];

  const isCurrentNotPending = current == null || current.status !== PENDING_STATUS;
  if (isCurrentNotPending) return details.queue;

  const elements = [...details.queue.items];
  elements[details.index] = {
    status: details.status,
    conversation: current.conversation,
    project: current.project,
    attempts: current.attempts + 1,
    completedAt: details.timestamp,
  };
  return { ...details.queue, updatedAt: details.timestamp, items: elements };
};

export const deferChatOrganizationQueueElement = (details: {
  readonly queue: ChatOrganizationQueue;
  readonly index: number;
  readonly reason: string;
  readonly timestamp: string;
}): ChatOrganizationQueue => {
  const current = details.queue.items[details.index];

  const isCurrentNotPending = current == null || current.status !== PENDING_STATUS;
  if (isCurrentNotPending) return details.queue;

  const elements = [...details.queue.items];
  elements[details.index] = {
    status: PENDING_STATUS,
    conversation: current.conversation,
    project: current.project,
    attempts: current.attempts,
    lastReason: details.reason,
  };
  return { ...details.queue, updatedAt: details.timestamp, items: elements };
};

export const failChatOrganizationQueueElement = (details: {
  readonly queue: ChatOrganizationQueue;
  readonly index: number;
  readonly reason: string;
  readonly maxAttempts: number;
  readonly timestamp: string;
}): ChatOrganizationQueue => {
  const current = details.queue.items[details.index];

  const isCurrentNotPending = current == null || current.status !== PENDING_STATUS;
  if (isCurrentNotPending) return details.queue;

  const attempts = current.attempts + 1;
  const elements = [...details.queue.items];

  const isAttemptsAtLeastMaxAttempts = attempts >= details.maxAttempts;
  if (isAttemptsAtLeastMaxAttempts) {
    elements[details.index] = {
      status: FAILED_STATUS,
      conversation: current.conversation,
      project: current.project,
      attempts,
      reason: details.reason,
      completedAt: details.timestamp,
    };
  } else {
    elements[details.index] = {
      status: PENDING_STATUS,
      conversation: current.conversation,
      project: current.project,
      attempts,
      lastReason: details.reason,
    };
  }

  return { ...details.queue, updatedAt: details.timestamp, items: elements };
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

  for (const element of queue.items) {
    const isStatusPending = element.status === PENDING_STATUS;
    const isStatusMoved = element.status === MOVED_STATUS;
    const isStatusAlreadyFiled = element.status === ALREADY_FILED_STATUS;

    if (isStatusPending) summary.pending += 1;
    else if (isStatusMoved) summary.moved += 1;
    else if (isStatusAlreadyFiled) summary.alreadyFiled += 1;
    else summary.failed += 1;
  }

  return summary;
};

const readConversationIdentity = (field: string): string => {
  const trimmed = field.trim();
  const conversationPath = /\/c\/(?<id>[^/?#]+)/u.exec(trimmed)?.groups?.id;

  const hasConversationPath = conversationPath != null;
  if (hasConversationPath) return conversationPath;

  return trimmed;
};

export const reopenChatOrganizationQueueElements = (details: {
  readonly queue: ChatOrganizationQueue;
  readonly conversations: readonly string[];
  readonly maxAttempts: number;
  readonly timestamp: string;
}): ChatOrganizationQueue => {
  const targets = new Set(details.conversations.map(readConversationIdentity));
  let changed = false;
  const elements = details.queue.items.map((element) => {
    const isElementSkipped =
      (element.status !== MOVED_STATUS && element.status !== ALREADY_FILED_STATUS) ||
      element.attempts >= details.maxAttempts ||
      !targets.has(readConversationIdentity(element.conversation));
    if (isElementSkipped) {
      return element;
    }

    changed = true;
    return {
      status: PENDING_STATUS,
      conversation: element.conversation,
      project: element.project,
      attempts: element.attempts,
      lastReason: "Full-history audit found the Conversation still loose.",
    };
  });

  const isNotChanged = !changed;
  if (isNotChanged) return details.queue;

  return { ...details.queue, items: elements, updatedAt: details.timestamp };
};

export const verifyChatOrganizationQueue = (details: {
  readonly queue: ChatOrganizationQueue;
  readonly orphans: readonly { readonly id: string; readonly title: string }[];
  readonly timestamp: string;
}): ChatOrganizationVerification => {
  const orphanIdentities = new Set<string>();

  for (const orphan of details.orphans) {
    orphanIdentities.add(readConversationIdentity(orphan.id));
    orphanIdentities.add(orphan.title.trim());
  }

  const plannedStillLoose = details.queue.items
    .filter((element) => orphanIdentities.has(readConversationIdentity(element.conversation)))
    .map((element) => element.conversation);
  const summary = summarizeChatOrganizationQueue(details.queue);

  return {
    complete: summary.pending === 0 && summary.failed === 0 && plannedStillLoose.length === 0,
    inventoryComplete: true,
    remainingOrphans: details.orphans.length,
    plannedStillLoose,
    verifiedAt: details.timestamp,
  };
};
