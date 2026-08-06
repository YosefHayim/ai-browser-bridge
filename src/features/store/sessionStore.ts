import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hasErrorCode } from "@/features/domain";
import { defaultSessionStoreDir } from "./paths.ts";

const METADATA_FILE = "metadata.json";
const EVENTS_FILE = "events.jsonl";
// Session directory names must be path-safe single segments.
const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type TimestampInput = Date | string;

export type SessionStoreOptions = {
  baseDir?: string;
  now?: () => Date;
  createId?: () => string;
};

export type SessionMetadata = {
  id: string;
  repoPath: string;
  model: string | null;
  contextLimit: number;
  tunnelUrl: string | null;
  startedAt: string;
  updatedAt: string;
};

export type SessionEventRole = "user" | "assistant" | "system" | "tool";

export type SessionEvent = {
  id: string;
  type: string;
  createdAt: string;
  role?: SessionEventRole;
  name?: string;
  status?: string;
  content?: string;
  data?: Record<string, unknown>;
};

export type SessionRecord = {
  metadata: SessionMetadata;
  events: SessionEvent[];
};

export type CreateSessionInput = {
  id?: string;
  repoPath: string;
  model?: string | null;
  contextLimit: number;
  tunnelUrl?: string | null;
  startedAt?: TimestampInput;
  updatedAt?: TimestampInput;
};

export type UpdateSessionInput = {
  repoPath?: string;
  model?: string | null;
  contextLimit?: number;
  tunnelUrl?: string | null;
  updatedAt?: TimestampInput;
};

export type AppendSessionEventInput = {
  id?: string;
  type: string;
  createdAt?: TimestampInput;
  role?: SessionEventRole;
  name?: string;
  status?: string;
  content?: string;
  data?: Record<string, unknown>;
};

export type SessionExport = SessionRecord & {
  transcript: string;
  json: string;
  jsonl: string;
};

type SessionPaths = {
  baseDir: string;
  sessionDir: string;
  metadataPath: string;
  eventsPath: string;
};

const sessionDirectory = (options: SessionStoreOptions): string => {
  if (options.baseDir !== undefined) return options.baseDir;
  return defaultSessionStoreDir();
};

const sessionPaths = (id: string, options: SessionStoreOptions): SessionPaths => {
  const safeId = normalizeSessionId(id);
  const baseDir = sessionDirectory(options);
  const sessionDir = join(baseDir, safeId);
  return {
    baseDir,
    sessionDir,
    metadataPath: join(sessionDir, METADATA_FILE),
    eventsPath: join(sessionDir, EVENTS_FILE),
  };
};

const sessionClock = (options: SessionStoreOptions): (() => Date) => {
  if (options.now !== undefined) return options.now;
  return () => new Date();
};

const nextSessionId = (options: SessionStoreOptions): (() => string) => {
  if (options.createId !== undefined) return options.createId;
  return randomUUID;
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
  if (value instanceof Date) {
    const iso = value.toISOString();
    if (Number.isNaN(Date.parse(iso))) throw new Error(`Invalid timestamp: ${iso}`);
    return iso;
  }
  if (Number.isNaN(Date.parse(value))) throw new Error(`Invalid timestamp: ${value}`);
  return value;
};

const latestTimestamp = (left: string, right: string): string => {
  if (Date.parse(left) >= Date.parse(right)) return left;
  return right;
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
  const eventData = record.data;
  if (eventData === undefined) return;
  if (!isRecord(eventData)) throw new Error(`Expected data to be an object in ${source}`);
  event.data = eventData;
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

const sessionMetadata = (
  input: CreateSessionInput,
  options: SessionStoreOptions,
): SessionMetadata => {
  const id =
    input.id === undefined
      ? normalizeSessionId(nextSessionId(options)())
      : normalizeSessionId(input.id);
  const startedAt =
    input.startedAt === undefined
      ? normalizeTimestamp(sessionClock(options)())
      : normalizeTimestamp(input.startedAt);
  const updatedAt =
    input.updatedAt === undefined
      ? normalizeTimestamp(startedAt)
      : normalizeTimestamp(input.updatedAt);
  const model = input.model === undefined ? null : input.model;
  const tunnelUrl = input.tunnelUrl === undefined ? null : input.tunnelUrl;
  return {
    id,
    repoPath: input.repoPath,
    model,
    contextLimit: normalizeContextLimit(input.contextLimit),
    tunnelUrl,
    startedAt,
    updatedAt,
  };
};

const sessionEvent = (
  input: AppendSessionEventInput,
  options: SessionStoreOptions,
): SessionEvent => {
  const id =
    input.id === undefined
      ? normalizeSessionEventId(nextSessionId(options)())
      : normalizeSessionEventId(input.id);
  const createdAt =
    input.createdAt === undefined
      ? normalizeTimestamp(sessionClock(options)())
      : normalizeTimestamp(input.createdAt);
  const event: SessionEvent = {
    id,
    type: input.type,
    createdAt,
  };
  if (input.role) event.role = input.role;
  if (input.name !== undefined) event.name = input.name;
  if (input.status !== undefined) event.status = input.status;
  if (input.content !== undefined) event.content = input.content;
  if (input.data !== undefined) event.data = input.data;
  return event;
};

const mergeSessionMetadata = (
  current: SessionMetadata,
  input: UpdateSessionInput,
  options: SessionStoreOptions,
): SessionMetadata => {
  const updatedAt =
    input.updatedAt === undefined
      ? normalizeTimestamp(sessionClock(options)())
      : normalizeTimestamp(input.updatedAt);
  return {
    id: current.id,
    repoPath: input.repoPath === undefined ? current.repoPath : input.repoPath,
    model: input.model === undefined ? current.model : input.model,
    contextLimit:
      input.contextLimit === undefined
        ? current.contextLimit
        : normalizeContextLimit(input.contextLimit),
    tunnelUrl: input.tunnelUrl === undefined ? current.tunnelUrl : input.tunnelUrl,
    startedAt: current.startedAt,
    updatedAt,
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
): Promise<SessionMetadata | undefined> => {
  if (!entry.isDirectory() || !SAFE_SESSION_ID.test(entry.name)) return undefined;
  try {
    return await readMetadata(join(baseDir, entry.name, METADATA_FILE));
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
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

const eventDetail = (event: SessionEvent): string => {
  if (event.content !== undefined) return event.content;
  if (event.data !== undefined) return JSON.stringify(event.data);
  return "";
};

const formatMessageTranscript = (event: SessionEvent, prefix: string): string => {
  const role = event.role === undefined ? "message" : event.role;
  const content = event.content === undefined ? "" : event.content;
  return `${prefix} ${role}: ${content}`;
};

const formatActionTranscript = (event: SessionEvent, prefix: string): string => {
  const name = event.name ? ` ${event.name}` : "";
  const status = event.status ? ` ${event.status}` : "";
  const detail = eventDetail(event);
  if (detail.length === 0) return `${prefix} action${name}${status}`;
  return `${prefix} action${name}${status}: ${detail}`;
};

const formatGenericTranscript = (event: SessionEvent, prefix: string): string => {
  const label = [event.type, event.name, event.status].filter(Boolean).join(" ");
  const detail = eventDetail(event);
  if (detail.length === 0) return `${prefix} ${label}`;
  return `${prefix} ${label}: ${detail}`;
};

const formatTranscriptEvent = (event: SessionEvent): string => {
  const prefix = `[${event.createdAt}]`;
  if (event.type === "message") return formatMessageTranscript(event, prefix);
  if (event.type === "action") return formatActionTranscript(event, prefix);
  return formatGenericTranscript(event, prefix);
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

/** Persistent session store for bridge conversations (options-bound handle). */
export class SessionStore {
  constructor(private readonly options: SessionStoreOptions = {}) {}

  async createSession(input: CreateSessionInput): Promise<SessionRecord> {
    return createSession(input, this.options);
  }

  async loadSession(id: string): Promise<SessionRecord> {
    return loadSession(id, this.options);
  }

  async listSessions(): Promise<SessionMetadata[]> {
    return listSessions(this.options);
  }

  async appendEvent(sessionId: string, input: AppendSessionEventInput): Promise<SessionEvent> {
    return appendSessionEvent(sessionId, input, this.options);
  }
}

export const createSession = async (
  input: CreateSessionInput,
  options: SessionStoreOptions = {},
): Promise<SessionRecord> => {
  const metadata = sessionMetadata(input, options);
  await initSessionDir(metadata, options);
  return { metadata, events: [] };
};

export const loadSession = async (
  id: string,
  options: SessionStoreOptions = {},
): Promise<SessionRecord> => {
  const paths = sessionPaths(id, options);
  return {
    metadata: await readMetadata(paths.metadataPath),
    events: await readEvents(paths.eventsPath),
  };
};

export const listSessions = async (
  options: SessionStoreOptions = {},
): Promise<SessionMetadata[]> => {
  const baseDir = sessionDirectory(options);
  const sessions = await collectSessionMetadata(baseDir, await readSessionDirEntries(baseDir));
  return sortSessionsByActivity(sessions);
};

export const appendSessionEvent = async (
  sessionId: string,
  input: AppendSessionEventInput,
  options: SessionStoreOptions = {},
): Promise<SessionEvent> => {
  const paths = sessionPaths(sessionId, options);
  const metadata = await readMetadata(paths.metadataPath);
  const event = sessionEvent(input, options);
  await persistAppendedEvent({ paths, metadata, event });
  return event;
};

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

export const getLatestSession = async (
  options: SessionStoreOptions = {},
): Promise<SessionRecord | null> => {
  const baseDir = sessionDirectory(options);
  const entries = await readSessionDirEntries(baseDir);
  const [latest] = sortSessionsByActivity(await collectSessionMetadata(baseDir, entries));
  if (!latest) return null;
  const paths = sessionPaths(latest.id, options);
  return { metadata: latest, events: await readEvents(paths.eventsPath) };
};
