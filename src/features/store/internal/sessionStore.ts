import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { appendFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { hasErrorCode } from "@/features/domain";
import { ensureInsideRepo } from "@/features/tools";

// ---------------------------------------------------------------------------
// Types — session
// ---------------------------------------------------------------------------

/** ISO timestamp or Date accepted by session store normalizers. */
export type TimestampInput = Date | string;

/** Options for session store I/O (base dir, clock, id factory). */
export interface SessionStoreOptions {
  baseDir?: string;
  now?: () => Date;
  createId?: () => string;
}

/** Persisted session metadata. */
export interface SessionMetadata {
  id: string;
  repoPath: string;
  model: string | null;
  contextLimit: number;
  tunnelUrl: string | null;
  startedAt: string;
  updatedAt: string;
}

/** Role of a transcript message event. */
export type SessionEventRole = "user" | "assistant" | "system" | "tool";

/** One persisted session event (message, action, etc.). */
export interface SessionEvent {
  id: string;
  type: string;
  createdAt: string;
  role?: SessionEventRole;
  name?: string;
  status?: string;
  content?: string;
  data?: Record<string, unknown>;
}

/** Loaded session metadata plus its event log. */
export interface SessionRecord {
  metadata: SessionMetadata;
  events: SessionEvent[];
}

/** Input for {@link SessionStore.createSession}. */
export interface CreateSessionInput {
  id?: string;
  repoPath: string;
  model?: string | null;
  contextLimit: number;
  tunnelUrl?: string | null;
  startedAt?: TimestampInput;
  updatedAt?: TimestampInput;
}

/** Partial metadata patch for {@link updateSession}. */
export interface UpdateSessionInput {
  repoPath?: string;
  model?: string | null;
  contextLimit?: number;
  tunnelUrl?: string | null;
  updatedAt?: TimestampInput;
}

/** Input for {@link SessionStore.appendEvent}. */
export interface AppendSessionEventInput {
  id?: string;
  type: string;
  createdAt?: TimestampInput;
  role?: SessionEventRole;
  name?: string;
  status?: string;
  content?: string;
  data?: Record<string, unknown>;
}

/** Export bundle with human-readable and machine-readable formats. */
export interface SessionExport extends SessionRecord {
  transcript: string;
  json: string;
  jsonl: string;
}

/** Resolved on-disk paths for one session directory. */
interface SessionPaths {
  baseDir: string;
  sessionDir: string;
  metadataPath: string;
  eventsPath: string;
}

// ---------------------------------------------------------------------------
// Types — checkpoints
// ---------------------------------------------------------------------------

/** Checkpoint phase relative to a patch operation. */
export type CheckpointPhase = "before" | "after";

/** Snapshot of one file at checkpoint time. */
export interface CheckpointFileSnapshot {
  relativePath: string;
  exists: boolean;
  size: number;
  sha256?: string;
  snapshotRef?: string;
}

/** Full checkpoint record persisted on disk. */
export interface Checkpoint {
  id: string;
  repoRoot: string;
  createdAt: string;
  phase: CheckpointPhase;
  label?: string;
  files: CheckpointFileSnapshot[];
}

/** Summary row returned by {@link listCheckpoints}. */
export interface CheckpointSummary {
  id: string;
  createdAt: string;
  phase: CheckpointPhase;
  fileCount: number;
  label?: string;
}

/** Resolved absolute and relative path inside a repo. */
interface RepoPath {
  absolutePath: string;
  relativePath: string;
}

/** Options for {@link SessionStore.saveCheckpoint}. */
export interface CreateCheckpointOptions {
  repoRoot: string;
  paths: readonly string[];
  phase?: CheckpointPhase;
  label?: string;
  checkpointRoot?: string;
  now?: Date;
}

/** Options for {@link listCheckpoints}. */
export interface ListCheckpointsOptions {
  repoRoot: string;
  checkpointRoot?: string;
}

/** Options for {@link restoreCheckpoint}. */
export interface RestoreCheckpointOptions {
  repoRoot: string;
  checkpointId: string;
  checkpointRoot?: string;
  paths?: readonly string[];
}

/** Result of {@link restoreCheckpoint}. */
export interface RestoreCheckpointResult {
  checkpointId: string;
  restored: string[];
  removed: string[];
}

interface CheckpointIdInput {
  repoRoot: string;
  createdAt: string;
  phase: CheckpointPhase;
  label?: string;
  paths: readonly string[];
}

interface CreateCheckpointBuildContext {
  repoRoot: string;
  createdAt: string;
  phase: CheckpointPhase;
  label?: string;
  resolvedPaths: RepoPath[];
  checkpointDir: string;
  filesDir: string;
  id: string;
}

// ---------------------------------------------------------------------------
// Types — file resolver & logging
// ---------------------------------------------------------------------------

/** Result of resolving a single @file mention. */
export interface ResolvedFile {
  relPath: string;
  content: string;
}

export interface BridgeLogEvent {
  repoPath: string;
  type: string;
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const METADATA_FILE = "metadata.json";
const EVENTS_FILE = "events.jsonl";
const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const FILE_MENTION_RE = /@([\w./_-]+(?:\.[\w]+))/g;

/** Repo-local bridge directory name (e.g. `<repo>/.bridge`). */
export const REPO_DIR_NAME = ".bridge";

/** Machine-global home directory name for user-authored cross-repo config. */
export const BRIDGE_DIR_NAME = ".ai-browser-bridge";

/** Filename for hook config shared by repo and home directories. */
export const HOOKS_FILE = "hooks.json";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Absolute repo-local `.bridge` directory for a target repo.
 *
 * @param repoPath - Repository path used for bridge state.
 * @returns The `bridgeDir` result.
 * @example
 * ```ts
 * const result = bridgeDir(repoPath);
 * ```
 */
export const bridgeDir = (repoPath: string): string => {
  return join(repoPath, REPO_DIR_NAME);
};

/**
 * Per-repo persisted config file.
 *
 * @param repoPath - Repository path used for bridge state.
 * @returns The `configPath` result.
 * @example
 * ```ts
 * const result = configPath(repoPath);
 * ```
 */
export const configPath = (repoPath: string): string => {
  return join(bridgeDir(repoPath), "config.json");
};

/**
 * Per-repo bridge activity log directory.
 *
 * @param repoPath - Repository path used for bridge state.
 * @returns The `logsDir` result.
 * @example
 * ```ts
 * const result = logsDir(repoPath);
 * ```
 */
export const logsDir = (repoPath: string): string => {
  return join(bridgeDir(repoPath), "logs");
};

/**
 * Per-repo session store directory.
 *
 * @param repoPath - Repository path used for bridge state.
 * @returns The `sessionsDir` result.
 * @example
 * ```ts
 * const result = sessionsDir(repoPath);
 * ```
 */
export const sessionsDir = (repoPath: string): string => {
  return join(bridgeDir(repoPath), "sessions");
};

/**
 * Per-repo checkpoint store for MCP-patch rollbacks.
 *
 * @param repoPath - Repository path used for bridge state.
 * @returns The `checkpointsDir` result.
 * @example
 * ```ts
 * const result = checkpointsDir(repoPath);
 * ```
 */
export const checkpointsDir = (repoPath: string): string => {
  return join(bridgeDir(repoPath), "checkpoints");
};

/**
 * Per-repo default location for `/export` output.
 *
 * @param repoPath - Repository path used for bridge state.
 * @returns The `exportsDir` result.
 * @example
 * ```ts
 * const result = exportsDir(repoPath);
 * ```
 */
export const exportsDir = (repoPath: string): string => {
  return join(bridgeDir(repoPath), "exports");
};

/**
 * Per-repo screenshot output directory.
 *
 * @param repoPath - Repository path used for bridge state.
 * @returns The `screenshotsDir` result.
 * @example
 * ```ts
 * const result = screenshotsDir(repoPath);
 * ```
 */
export const screenshotsDir = (repoPath: string): string => {
  return join(bridgeDir(repoPath), "screenshots");
};

/**
 * Create `<repo>/.bridge` and assert its self-ignoring `.gitignore`.
 *
 * @param repoPath - Repository path used for bridge state.
 * @returns The `ensureBridgeDir` result.
 * @example
 * ```ts
 * const result = await ensureBridgeDir(repoPath);
 * ```
 */
export const ensureBridgeDir = async (repoPath: string): Promise<string> => {
  const dir = bridgeDir(repoPath);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, ".gitignore"), "*\n", "utf-8");
  return dir;
};

/**
 * Absolute machine-global bridge home for a given OS home directory.
 *
 * @param home - Home value.
 * @returns The `bridgeHome` result.
 * @example
 * ```ts
 * const result = bridgeHome(home);
 * ```
 */
export const bridgeHome = (home = homedir()): string => {
  return join(home, BRIDGE_DIR_NAME);
};

/**
 * Path to the user-level hooks config, honouring an injected home dir for tests.
 *
 * @param home - Home value.
 * @returns The `homeHooksPath` result.
 * @example
 * ```ts
 * const result = homeHooksPath(home);
 * ```
 */
export const homeHooksPath = (home = homedir()): string => {
  return join(bridgeHome(home), HOOKS_FILE);
};

/**
 * Default sessions directory for the current working directory.
 *
 * @returns The `defaultSessionStoreDir` result.
 * @example
 * ```ts
 * const result = defaultSessionStoreDir();
 * ```
 */
export const defaultSessionStoreDir = (): string => {
  return sessionsDir(process.cwd());
};

const resolveBaseDir = (options: SessionStoreOptions): string => {
  return options.baseDir ?? defaultSessionStoreDir();
};

const sessionPaths = (id: string, options: SessionStoreOptions): SessionPaths => {
  const safeId = normalizeSessionId(id);
  const baseDir = resolveBaseDir(options);
  const sessionDir = join(baseDir, safeId);
  return {
    baseDir,
    sessionDir,
    metadataPath: join(sessionDir, METADATA_FILE),
    eventsPath: join(sessionDir, EVENTS_FILE),
  };
};

// ---------------------------------------------------------------------------
// Session normalizers
// ---------------------------------------------------------------------------

const getNow = (options: SessionStoreOptions): (() => Date) => {
  return options.now ?? (() => new Date());
};

const getCreateId = (options: SessionStoreOptions): (() => string) => {
  return options.createId ?? randomUUID;
};

const normalizeSessionId = (id: string): string => {
  if (!SAFE_SESSION_ID.test(id)) throw new Error(`Invalid session id: ${id}`);
  return id;
};

const normalizeSessionEventId = (id: string): string => {
  if (id.length === 0 || id.includes("\n") || id.includes("\r")) {
    throw new Error("Invalid session event id");
  }
  return id;
};

const normalizeTimestamp = (value: TimestampInput): string => {
  const timestamp = value instanceof Date ? value.toISOString() : value;
  if (Number.isNaN(Date.parse(timestamp))) throw new Error(`Invalid timestamp: ${timestamp}`);
  return timestamp;
};

const latestTimestamp = (left: string, right: string): string => {
  return Date.parse(left) >= Date.parse(right) ? left : right;
};

const normalizeContextLimit = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid context limit: ${value}`);
  return value;
};

const normalizeRole = (role: string, source: string): SessionEventRole => {
  if (role === "user" || role === "assistant" || role === "system" || role === "tool") return role;
  throw new Error(`Invalid role in ${source}: ${role}`);
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const readString = (record: Record<string, unknown>, key: string, source: string): string => {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`Expected ${key} to be a string in ${source}`);
  return value;
};

const readOptionalString = (
  record: Record<string, unknown>,
  key: string,
  source: string,
): string | undefined => {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`Expected ${key} to be a string in ${source}`);
  return value;
};

const readNullableString = (
  record: Record<string, unknown>,
  key: string,
  source: string,
): string | null => {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "string")
    throw new Error(`Expected ${key} to be a string or null in ${source}`);
  return value;
};

const readNumber = (record: Record<string, unknown>, key: string, source: string): number => {
  const value = record[key];
  if (typeof value !== "number") throw new Error(`Expected ${key} to be a number in ${source}`);
  return value;
};

const parseJsonObject = (raw: string, source: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new Error(`Expected JSON object in ${source}`);
  return parsed;
};

// ---------------------------------------------------------------------------
// Session deserialize
// ---------------------------------------------------------------------------

const metadataFromObject = (record: Record<string, unknown>, source: string): SessionMetadata => {
  return {
    id: normalizeSessionId(readString(record, "id", source)),
    repoPath: readString(record, "repoPath", source),
    model: readNullableString(record, "model", source),
    contextLimit: normalizeContextLimit(readNumber(record, "contextLimit", source)),
    tunnelUrl: readNullableString(record, "tunnelUrl", source),
    startedAt: normalizeTimestamp(readString(record, "startedAt", source)),
    updatedAt: normalizeTimestamp(readString(record, "updatedAt", source)),
  };
};

const applyOptionalEventFields = (
  event: SessionEvent,
  record: Record<string, unknown>,
  source: string,
): void => {
  const role = readOptionalString(record, "role", source);
  if (role !== undefined) event.role = normalizeRole(role, source);
  for (const field of ["name", "status", "content"] as const) {
    const value = readOptionalString(record, field, source);
    if (value !== undefined) event[field] = value;
  }
  const data = record.data;
  if (data === undefined) return;
  if (!isRecord(data)) throw new Error(`Expected data to be an object in ${source}`);
  event.data = data;
};

const eventFromObject = (record: Record<string, unknown>, source: string): SessionEvent => {
  const event: SessionEvent = {
    id: readString(record, "id", source),
    type: readString(record, "type", source),
    createdAt: normalizeTimestamp(readString(record, "createdAt", source)),
  };
  applyOptionalEventFields(event, record, source);
  return event;
};

// ---------------------------------------------------------------------------
// Session read / write
// ---------------------------------------------------------------------------

const readMetadata = async (path: string): Promise<SessionMetadata> => {
  const raw = await readFile(path, "utf-8");
  return metadataFromObject(parseJsonObject(raw, path), path);
};

const readRawEvents = async (path: string): Promise<string> => {
  try {
    return await readFile(path, "utf-8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return "";
    throw error;
  }
};

const parseEventLine = (line: string, path: string): SessionEvent => {
  const source = `${path}:${line.length}`;
  return eventFromObject(parseJsonObject(line, source), source);
};

const readEvents = async (path: string): Promise<SessionEvent[]> => {
  const raw = await readRawEvents(path);
  if (raw.trim().length === 0) return [];
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => parseEventLine(line, path));
};

const writeMetadata = async (path: string, metadata: SessionMetadata): Promise<void> => {
  await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");
};

const readSessionDirEntries = async (baseDir: string): Promise<Dirent[]> => {
  try {
    return await readdir(baseDir, { withFileTypes: true });
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return [];
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Session build / update / list
// ---------------------------------------------------------------------------

const buildSessionMetadata = (
  input: CreateSessionInput,
  options: SessionStoreOptions,
): SessionMetadata => {
  const id = normalizeSessionId(input.id ?? getCreateId(options)());
  const startedAt = normalizeTimestamp(input.startedAt ?? getNow(options)());
  const updatedAt = normalizeTimestamp(input.updatedAt ?? startedAt);
  return {
    id,
    repoPath: input.repoPath,
    model: input.model ?? null,
    contextLimit: normalizeContextLimit(input.contextLimit),
    tunnelUrl: input.tunnelUrl ?? null,
    startedAt,
    updatedAt,
  };
};

const buildSessionEvent = (
  input: AppendSessionEventInput,
  options: SessionStoreOptions,
): SessionEvent => {
  return {
    id: normalizeSessionEventId(input.id ?? getCreateId(options)()),
    type: input.type,
    createdAt: normalizeTimestamp(input.createdAt ?? getNow(options)()),
    ...(input.role ? { role: input.role } : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.content !== undefined ? { content: input.content } : {}),
    ...(input.data !== undefined ? { data: input.data } : {}),
  };
};

const mergeSessionMetadata = (
  current: SessionMetadata,
  input: UpdateSessionInput,
  options: SessionStoreOptions,
): SessionMetadata => {
  return {
    ...current,
    ...(input.repoPath !== undefined ? { repoPath: input.repoPath } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.contextLimit !== undefined
      ? { contextLimit: normalizeContextLimit(input.contextLimit) }
      : {}),
    ...(input.tunnelUrl !== undefined ? { tunnelUrl: input.tunnelUrl } : {}),
    updatedAt: normalizeTimestamp(input.updatedAt ?? getNow(options)()),
  };
};

const initSessionDir = async (
  metadata: SessionMetadata,
  options: SessionStoreOptions,
): Promise<void> => {
  const paths = sessionPaths(metadata.id, options);
  await mkdir(paths.baseDir, { recursive: true });
  await mkdir(paths.sessionDir);
  await writeMetadata(paths.metadataPath, metadata);
  await writeFile(paths.eventsPath, "", "utf-8");
};

const persistAppendedEvent = async (input: {
  paths: SessionPaths;
  metadata: SessionMetadata;
  event: SessionEvent;
}): Promise<void> => {
  await appendFile(input.paths.eventsPath, `${JSON.stringify(input.event)}\n`, "utf-8");
  await writeMetadata(input.paths.metadataPath, {
    ...input.metadata,
    updatedAt: latestTimestamp(input.metadata.updatedAt, input.event.createdAt),
  });
};

const tryReadSessionMetadata = async (
  baseDir: string,
  entry: Dirent,
): Promise<SessionMetadata | null> => {
  if (!entry.isDirectory() || !SAFE_SESSION_ID.test(entry.name)) return null;
  try {
    return await readMetadata(join(baseDir, entry.name, METADATA_FILE));
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw error;
  }
};

const collectSessionMetadata = async (
  baseDir: string,
  entries: Dirent[],
): Promise<SessionMetadata[]> => {
  const sessions: SessionMetadata[] = [];
  for (const entry of entries) {
    const metadata = await tryReadSessionMetadata(baseDir, entry);
    if (metadata) sessions.push(metadata);
  }
  return sessions;
};

const sortSessionsByActivity = (sessions: SessionMetadata[]): SessionMetadata[] => {
  return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
};

// ---------------------------------------------------------------------------
// Session transcript / export
// ---------------------------------------------------------------------------

const eventDetail = (event: SessionEvent): string => {
  return event.content ?? (event.data ? JSON.stringify(event.data) : "");
};

const formatTranscriptEvent = (event: SessionEvent): string => {
  const prefix = `[${event.createdAt}]`;
  if (event.type === "message")
    return `${prefix} ${event.role ?? "message"}: ${event.content ?? ""}`;
  if (event.type === "action") {
    const name = event.name ? ` ${event.name}` : "";
    const status = event.status ? ` ${event.status}` : "";
    const detail = eventDetail(event);
    return detail
      ? `${prefix} action${name}${status}: ${detail}`
      : `${prefix} action${name}${status}`;
  }
  const label = [event.type, event.name, event.status].filter(Boolean).join(" ");
  const detail = eventDetail(event);
  return detail ? `${prefix} ${label}: ${detail}` : `${prefix} ${label}`;
};

const formatTranscript = (events: SessionEvent[]): string => {
  return events.map(formatTranscriptEvent).join("\n");
};

const loadSessionRecord = async (
  sessionId: string,
  options: SessionStoreOptions,
): Promise<SessionRecord> => {
  const paths = sessionPaths(sessionId, options);
  return {
    metadata: await readMetadata(paths.metadataPath),
    events: await readEvents(paths.eventsPath),
  };
};

// ---------------------------------------------------------------------------
// Checkpoint helpers
// ---------------------------------------------------------------------------

const sha256 = (input: string | Buffer): string => {
  return createHash("sha256").update(input).digest("hex");
};

const toPosixPath = (path: string): string => {
  return path.split(sep).join("/");
};

const checkpointStorageRoot = (
  repoRoot: string,
  checkpointRoot = checkpointsDir(repoRoot),
): string => {
  return join(checkpointRoot, sha256(resolve(repoRoot)).slice(0, 16));
};

const checkpointMetadataPath = (checkpointDir: string): string => {
  return join(checkpointDir, "checkpoint.json");
};

const resolveRepoPath = (repoRoot: string, path: string): RepoPath => {
  const normalizedRoot = resolve(repoRoot);
  const absolutePath = resolve(normalizedRoot, path);
  if (absolutePath !== normalizedRoot && !absolutePath.startsWith(normalizedRoot + sep)) {
    throw new Error(`Path escapes repo root: ${path}`);
  }
  return {
    absolutePath,
    relativePath: toPosixPath(relative(normalizedRoot, absolutePath) || "."),
  };
};

const resolveInside = (root: string, path: string): string => {
  const normalizedRoot = resolve(root);
  const resolved = resolve(normalizedRoot, path);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + sep)) {
    throw new Error(`Path escapes checkpoint store: ${path}`);
  }
  return resolved;
};

const uniquePaths = (paths: readonly string[]): string[] => {
  return [...new Set(paths)];
};

const checkpointId = (input: CheckpointIdInput): string => {
  const timestamp = input.createdAt.replace(/[:.]/g, "-");
  const digest = sha256(JSON.stringify(input)).slice(0, 12);
  return `${timestamp}-${input.phase}-${digest}`;
};

const defaultPhase = (phase?: CheckpointPhase): CheckpointPhase => {
  return phase ?? "before";
};

const buildCheckpointPaths = (ctx: {
  repoRoot: string;
  createdAt: string;
  phase: CheckpointPhase;
  label?: string;
  resolvedPaths: RepoPath[];
  checkpointRoot?: string;
}) => {
  const id = checkpointId({
    repoRoot: ctx.repoRoot,
    createdAt: ctx.createdAt,
    phase: ctx.phase,
    label: ctx.label,
    paths: ctx.resolvedPaths.map((entry) => entry.relativePath),
  });
  const checkpointDir = join(checkpointStorageRoot(ctx.repoRoot, ctx.checkpointRoot), id);
  return { id, checkpointDir, filesDir: join(checkpointDir, "files") };
};

const buildCreateCheckpointContext = (
  options: CreateCheckpointOptions,
): CreateCheckpointBuildContext => {
  const repoRoot = resolve(options.repoRoot);
  const phase = defaultPhase(options.phase);
  const createdAt = (options.now ?? new Date()).toISOString();
  const resolvedPaths = uniquePaths(options.paths).map((path) => resolveRepoPath(repoRoot, path));
  const base = { repoRoot, createdAt, phase, label: options.label, resolvedPaths };
  return { ...base, ...buildCheckpointPaths({ ...base, checkpointRoot: options.checkpointRoot }) };
};

const buildCheckpointRecord = (
  ctx: CreateCheckpointBuildContext,
  files: Checkpoint["files"],
): Checkpoint => {
  return {
    id: ctx.id,
    repoRoot: ctx.repoRoot,
    createdAt: ctx.createdAt,
    phase: ctx.phase,
    label: ctx.label,
    files,
  };
};

const buildSelectedPaths = (
  repoRoot: string,
  paths: readonly string[] | undefined,
): Set<string> | undefined => {
  if (!paths) return undefined;
  return new Set(paths.map((path) => resolveRepoPath(repoRoot, path).relativePath));
};

const tryStat = async (repoPath: RepoPath) => {
  try {
    return await stat(repoPath.absolutePath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
};

const writeFileSnapshot = async (
  repoPath: RepoPath,
  filesDir: string,
  fileStat: Awaited<ReturnType<typeof stat>>,
): Promise<CheckpointFileSnapshot> => {
  const contents = await readFile(repoPath.absolutePath);
  const contentHash = sha256(contents);
  const snapshotRef = `${contentHash}-${sha256(repoPath.relativePath).slice(0, 12)}`;
  await writeFile(join(filesDir, snapshotRef), contents);
  return {
    relativePath: repoPath.relativePath,
    exists: true,
    size: Number(fileStat.size),
    sha256: contentHash,
    snapshotRef,
  };
};

const snapshotFile = async (
  repoPath: RepoPath,
  filesDir: string,
): Promise<CheckpointFileSnapshot> => {
  const fileStat = await tryStat(repoPath);
  if (!fileStat) return { relativePath: repoPath.relativePath, exists: false, size: 0 };
  if (fileStat.isDirectory())
    throw new Error(`Cannot checkpoint directory: ${repoPath.relativePath}`);
  if (!fileStat.isFile())
    throw new Error(`Cannot checkpoint non-file path: ${repoPath.relativePath}`);
  return writeFileSnapshot(repoPath, filesDir, fileStat);
};

const readCheckpoint = async (checkpointDir: string): Promise<Checkpoint | undefined> => {
  try {
    return JSON.parse(await readFile(checkpointMetadataPath(checkpointDir), "utf-8")) as Checkpoint;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
};

const writeCheckpointFiles = async (
  ctx: CreateCheckpointBuildContext,
): Promise<Checkpoint["files"]> => {
  await mkdir(ctx.filesDir, { recursive: true });
  const files = [];
  for (const repoPath of ctx.resolvedPaths) files.push(await snapshotFile(repoPath, ctx.filesDir));
  return files;
};

const persistCheckpoint = async (
  ctx: CreateCheckpointBuildContext,
  files: Checkpoint["files"],
): Promise<Checkpoint> => {
  const checkpoint = buildCheckpointRecord(ctx, files);
  await writeFile(
    checkpointMetadataPath(ctx.checkpointDir),
    JSON.stringify(checkpoint, null, 2),
    "utf-8",
  );
  return checkpoint;
};

const readCheckpointDirEntries = async (storeRoot: string): Promise<Dirent[]> => {
  try {
    return await readdir(storeRoot, { withFileTypes: true });
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return [];
    throw error;
  }
};

const tryReadCheckpointSummary = async (
  storeRoot: string,
  entry: Dirent,
): Promise<CheckpointSummary | null> => {
  if (!entry.isDirectory()) return null;
  const checkpoint = await readCheckpoint(join(storeRoot, entry.name));
  if (!checkpoint) return null;
  return {
    id: checkpoint.id,
    createdAt: checkpoint.createdAt,
    phase: checkpoint.phase,
    label: checkpoint.label,
    fileCount: checkpoint.files.length,
  };
};

const collectCheckpointSummaries = async (
  storeRoot: string,
  entries: Dirent[],
): Promise<CheckpointSummary[]> => {
  const checkpoints: CheckpointSummary[] = [];
  for (const entry of entries) {
    const summary = await tryReadCheckpointSummary(storeRoot, entry);
    if (summary) checkpoints.push(summary);
  }
  return checkpoints;
};

const sortCheckpointSummaries = (checkpoints: CheckpointSummary[]): CheckpointSummary[] => {
  return checkpoints.sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
  );
};

const restoreExistingFile = async (input: {
  repoRoot: string;
  checkpointDir: string;
  file: CheckpointFileSnapshot;
  target: RepoPath;
  restored: string[];
}): Promise<void> => {
  if (!input.file.snapshotRef)
    throw new Error(`Checkpoint file is missing snapshot data: ${input.file.relativePath}`);
  const snapshotPath = resolveInside(input.checkpointDir, join("files", input.file.snapshotRef));
  const contents = await readFile(snapshotPath);
  await mkdir(dirname(input.target.absolutePath), { recursive: true });
  await writeFile(input.target.absolutePath, contents);
  input.restored.push(input.target.relativePath);
};

const restoreFile = async (input: {
  repoRoot: string;
  checkpointDir: string;
  file: CheckpointFileSnapshot;
  restored: string[];
  removed: string[];
}): Promise<void> => {
  const target = resolveRepoPath(input.repoRoot, input.file.relativePath);
  if (input.file.exists) {
    await restoreExistingFile({ ...input, target });
    return;
  }
  await rm(target.absolutePath, { force: true });
  input.removed.push(target.relativePath);
};

const validateSelectedPaths = (
  checkpoint: Checkpoint,
  selectedPaths: Set<string> | undefined,
): void => {
  if (!selectedPaths) return;
  for (const selectedPath of selectedPaths) {
    if (!checkpoint.files.some((file) => file.relativePath === selectedPath)) {
      throw new Error(`Checkpoint does not include path: ${selectedPath}`);
    }
  }
};

const restoreAllFiles = async (input: {
  repoRoot: string;
  checkpointDir: string;
  checkpoint: Checkpoint;
  selectedPaths: Set<string> | undefined;
}): Promise<RestoreCheckpointResult> => {
  const restored: string[] = [];
  const removed: string[] = [];
  for (const file of input.checkpoint.files) {
    if (input.selectedPaths && !input.selectedPaths.has(file.relativePath)) continue;
    await restoreFile({
      repoRoot: input.repoRoot,
      checkpointDir: input.checkpointDir,
      file,
      restored,
      removed,
    });
  }
  validateSelectedPaths(input.checkpoint, input.selectedPaths);
  return { checkpointId: input.checkpoint.id, restored, removed };
};

// ---------------------------------------------------------------------------
// File resolver
// ---------------------------------------------------------------------------

const readMentionContent = async (absPath: string, rawPath: string): Promise<string> => {
  try {
    const fileStat = await stat(absPath);
    if (!fileStat.isFile()) return `[not a file: ${rawPath}]`;
    if (fileStat.size > 100_000) return `[file too large: ${fileStat.size} bytes, max 100000]`;
    return await readFile(absPath, "utf-8");
  } catch {
    return `[file not found: ${rawPath}]`;
  }
};

const buildMentionResult = (input: {
  prompt: string;
  match: string;
  relPath: string;
  content: string;
}) => {
  const block = `\n--- @${input.relPath} ---\n${input.content}\n--- end @${input.relPath} ---\n`;
  return {
    prompt: input.prompt.replace(input.match, block),
    file: { relPath: input.relPath, content: input.content },
  };
};

const resolveOneFileMention = async (input: {
  match: RegExpMatchArray;
  repoRoot: string;
  prompt: string;
}): Promise<{ prompt: string; file?: ResolvedFile }> => {
  const rawPath = input.match[1];
  if (rawPath === undefined) return { prompt: input.prompt };
  const absPath = resolve(input.repoRoot, rawPath);
  const relPath = relative(input.repoRoot, absPath);
  try {
    ensureInsideRepo(absPath, input.repoRoot);
  } catch {
    return { prompt: input.prompt };
  }
  const content = await readMentionContent(absPath, rawPath);
  return buildMentionResult({ prompt: input.prompt, match: input.match[0], relPath, content });
};

const resolveAllFileMentions = async (input: {
  input: string;
  repoRoot: string;
  matches: RegExpMatchArray[];
}): Promise<{ prompt: string; files: ResolvedFile[] }> => {
  const files: ResolvedFile[] = [];
  let prompt = input.input;
  for (const match of input.matches) {
    const result = await resolveOneFileMention({ match, repoRoot: input.repoRoot, prompt });
    prompt = result.prompt;
    if (result.file) files.push(result.file);
  }
  return { prompt, files };
};

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const formatLocalDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/**
 * Return today's bridge log path for a repo.
 *
 * @param repoPath - Repository path used for bridge state.
 * @param date - Date value.
 * @returns The `bridgeLogPath` result.
 * @example
 * ```ts
 * const result = bridgeLogPath(repoPath, date);
 * ```
 */
export const bridgeLogPath = (repoPath: string, date = new Date()): string => {
  return join(logsDir(repoPath), `${formatLocalDate(date)}.jsonl`);
};

/**
 * Append one JSONL event to the repo's local bridge log.
 *
 * @param event - Event value.
 * @returns Completes when `appendBridgeLog` finishes.
 * @example
 * ```ts
 * await appendBridgeLog(event);
 * ```
 */
export const appendBridgeLog = async (event: BridgeLogEvent): Promise<void> => {
  await mkdir(logsDir(event.repoPath), { recursive: true });
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    repoPath: event.repoPath,
    type: event.type,
    data: event.data ?? {},
  });
  await appendFile(bridgeLogPath(event.repoPath), `${line}\n`, "utf-8");
};

// ---------------------------------------------------------------------------
// SessionStore
// ---------------------------------------------------------------------------

/** Persistent session and checkpoint store for bridge conversations. */
export class SessionStore {
  constructor(private readonly options: SessionStoreOptions = {}) {}

  /**
   * Create a new session directory with empty event log.
   *
   * @param input - Input values for the method.
   * @returns The `createSession` result.
   * @example
   * ```ts
   * const result = await sessionStore.createSession(input);
   * ```
   */
  async createSession(input: CreateSessionInput): Promise<SessionRecord> {
    const metadata = buildSessionMetadata(input, this.options);
    await initSessionDir(metadata, this.options);
    return { metadata, events: [] };
  }

  /**
   * Load session metadata and events from disk.
   *
   * @param id - Id value.
   * @returns The `loadSession` result.
   * @example
   * ```ts
   * const result = await sessionStore.loadSession(id);
   * ```
   */
  async loadSession(id: string): Promise<SessionRecord> {
    const paths = sessionPaths(id, this.options);
    return {
      metadata: await readMetadata(paths.metadataPath),
      events: await readEvents(paths.eventsPath),
    };
  }

  /**
   * List all sessions sorted by most recent activity.
   *
   * @returns The `listSessions` result.
   * @example
   * ```ts
   * const result = await sessionStore.listSessions();
   * ```
   */
  async listSessions(): Promise<SessionMetadata[]> {
    const baseDir = resolveBaseDir(this.options);
    const sessions = await collectSessionMetadata(baseDir, await readSessionDirEntries(baseDir));
    return sortSessionsByActivity(sessions);
  }

  /**
   * Snapshot the current state of repo files before or after a patch.
   *
   * @param options - Options that configure the method.
   * @returns The `saveCheckpoint` result.
   * @example
   * ```ts
   * const result = await sessionStore.saveCheckpoint(options);
   * ```
   */
  async saveCheckpoint(options: CreateCheckpointOptions): Promise<Checkpoint> {
    const ctx = buildCreateCheckpointContext(options);
    const files = await writeCheckpointFiles(ctx);
    return persistCheckpoint(ctx, files);
  }

  /**
   * Append one event to a session's JSONL log and bump `updatedAt`.
   *
   * @param sessionId - Session id value.
   * @param input - Input values for the method.
   * @returns The `appendEvent` result.
   * @example
   * ```ts
   * const result = await sessionStore.appendEvent(sessionId, input);
   * ```
   */
  async appendEvent(sessionId: string, input: AppendSessionEventInput): Promise<SessionEvent> {
    const paths = sessionPaths(sessionId, this.options);
    const metadata = await readMetadata(paths.metadataPath);
    const event = buildSessionEvent(input, this.options);
    await persistAppendedEvent({ paths, metadata, event });
    return event;
  }
}

// ---------------------------------------------------------------------------
// Public module-level wrappers over the default SessionStore instance.
// ---------------------------------------------------------------------------

/**
 * Create a new session directory with empty event log.
 *
 * @param input - Input values for the operation.
 * @param options - Options that configure the operation.
 * @returns The `createSession` result.
 * @example
 * ```ts
 * const result = await createSession(input, options);
 * ```
 */
export const createSession = async (
  input: CreateSessionInput,
  options: SessionStoreOptions = {},
): Promise<SessionRecord> => {
  return new SessionStore(options).createSession(input);
};

/**
 * Load session metadata and events from disk.
 *
 * @param id - Id value.
 * @param options - Options that configure the operation.
 * @returns The `loadSession` result.
 * @example
 * ```ts
 * const result = await loadSession(id, options);
 * ```
 */
export const loadSession = async (
  id: string,
  options: SessionStoreOptions = {},
): Promise<SessionRecord> => {
  return new SessionStore(options).loadSession(id);
};

/**
 * List all sessions sorted by most recent activity.
 *
 * @param options - Options that configure the operation.
 * @returns The `listSessions` result.
 * @example
 * ```ts
 * const result = await listSessions(options);
 * ```
 */
export const listSessions = async (
  options: SessionStoreOptions = {},
): Promise<SessionMetadata[]> => {
  return new SessionStore(options).listSessions();
};

/**
 * Append one event to a session's JSONL log and bump `updatedAt`.
 *
 * @param sessionId - Session id value.
 * @param input - Input values for the operation.
 * @param options - Options that configure the operation.
 * @returns The `appendSessionEvent` result.
 * @example
 * ```ts
 * const result = await appendSessionEvent(sessionId, input, options);
 * ```
 */
export const appendSessionEvent = async (
  sessionId: string,
  input: AppendSessionEventInput,
  options: SessionStoreOptions = {},
): Promise<SessionEvent> => {
  return new SessionStore(options).appendEvent(sessionId, input);
};

/**
 * Patch session metadata on disk.
 *
 * @param sessionId - Session id value.
 * @param input - Input values for the operation.
 * @param options - Options that configure the operation.
 * @returns The `updateSession` result.
 * @example
 * ```ts
 * const result = await updateSession(sessionId, input, options);
 * ```
 */
export const updateSession = async (
  sessionId: string,
  input: UpdateSessionInput,
  options: SessionStoreOptions = {},
): Promise<SessionMetadata> => {
  const paths = sessionPaths(sessionId, options);
  const next = mergeSessionMetadata(await readMetadata(paths.metadataPath), input, options);
  await writeMetadata(paths.metadataPath, next);
  return next;
};

/**
 * Export a session with transcript, JSON, and JSONL formats.
 *
 * @param sessionId - Session id value.
 * @param options - Options that configure the operation.
 * @returns The `exportSession` result.
 * @example
 * ```ts
 * const result = await exportSession(sessionId, options);
 * ```
 */
export const exportSession = async (
  sessionId: string,
  options: SessionStoreOptions = {},
): Promise<SessionExport> => {
  const record = await loadSessionRecord(sessionId, options);
  const jsonl = await readRawEvents(sessionPaths(sessionId, options).eventsPath);
  return {
    ...record,
    transcript: formatTranscript(record.events),
    json: `${JSON.stringify(record, null, 2)}\n`,
    jsonl,
  };
};

/**
 * Return the most recently updated session, or null when none exist.
 *
 * @param options - Options that configure the operation.
 * @returns The `getLatestSession` result.
 * @example
 * ```ts
 * const result = await getLatestSession(options);
 * ```
 */
export const getLatestSession = async (
  options: SessionStoreOptions = {},
): Promise<SessionRecord | null> => {
  const baseDir = resolveBaseDir(options);
  const entries = await readSessionDirEntries(baseDir);
  const [latest] = sortSessionsByActivity(await collectSessionMetadata(baseDir, entries));
  if (!latest) return null;
  const paths = sessionPaths(latest.id, options);
  return { metadata: latest, events: await readEvents(paths.eventsPath) };
};

/**
 * Snapshot the current state of repo files before or after a patch.
 *
 * @param options - Options that configure the operation.
 * @returns The `createCheckpoint` result.
 * @example
 * ```ts
 * const result = await createCheckpoint(options);
 * ```
 */
export const createCheckpoint = async (options: CreateCheckpointOptions): Promise<Checkpoint> => {
  return new SessionStore().saveCheckpoint(options);
};

/**
 * List checkpoints for a repository.
 *
 * @param options - Options that configure the operation.
 * @returns The `listCheckpoints` result.
 * @example
 * ```ts
 * const result = await listCheckpoints(options);
 * ```
 */
export const listCheckpoints = async (
  options: ListCheckpointsOptions,
): Promise<CheckpointSummary[]> => {
  const storeRoot = checkpointStorageRoot(options.repoRoot, options.checkpointRoot);
  const summaries = await collectCheckpointSummaries(
    storeRoot,
    await readCheckpointDirEntries(storeRoot),
  );
  return sortCheckpointSummaries(summaries);
};

/**
 * Restore all or selected files from a checkpoint.
 *
 * @param options - Options that configure the operation.
 * @returns The `restoreCheckpoint` result.
 * @example
 * ```ts
 * const result = await restoreCheckpoint(options);
 * ```
 */
export const restoreCheckpoint = async (
  options: RestoreCheckpointOptions,
): Promise<RestoreCheckpointResult> => {
  const repoRoot = resolve(options.repoRoot);
  const checkpointDir = join(
    checkpointStorageRoot(repoRoot, options.checkpointRoot),
    options.checkpointId,
  );
  const checkpoint = await readCheckpoint(checkpointDir);
  if (!checkpoint) throw new Error(`Checkpoint not found: ${options.checkpointId}`);
  return restoreAllFiles({
    repoRoot,
    checkpointDir,
    checkpoint,
    selectedPaths: buildSelectedPaths(repoRoot, options.paths),
  });
};

/**
 * Extract repo-relative @file mentions from terminal input.
 *
 * @param input - Input values for the operation.
 * @returns The `extractFileMentions` result.
 * @example
 * ```ts
 * const result = extractFileMentions(input);
 * ```
 */
export const extractFileMentions = (input: string): string[] => {
  const mentions = [...input.matchAll(FILE_MENTION_RE)]
    .map((match) => match[1])
    .filter((mention): mention is string => mention !== undefined);
  return [...new Set(mentions)];
};

/**
 * Parse @file mentions from user input and resolve them to file contents.
 * Returns the processed prompt with file contents injected, plus the list of
 * resolved files for context tracking.
 *
 * @param input - Input values for the operation.
 * @param repoRoot - Absolute repository root.
 * @returns The `resolveFileMentions` result.
 * @example
 * ```ts
 * const result = await resolveFileMentions(input, repoRoot);
 * ```
 */
export const resolveFileMentions = async (
  input: string,
  repoRoot: string,
): Promise<{ prompt: string; files: ResolvedFile[] }> => {
  const matches = [...input.matchAll(FILE_MENTION_RE)];
  if (matches.length === 0) return { prompt: input, files: [] };
  return resolveAllFileMentions({ input, repoRoot, matches });
};
