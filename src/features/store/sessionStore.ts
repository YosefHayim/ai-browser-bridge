import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hasErrorCode } from "@/features/domain";
import { defaultSessionStoreDir } from "./paths.ts";

const METADATA_FILE = "metadata.json";
const EVENTS_FILE = "events.jsonl";
const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

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

/** Persistent session store for bridge conversations. */
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
