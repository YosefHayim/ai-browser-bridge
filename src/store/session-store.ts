import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hasErrorCode } from "@/domain/errors.ts";
import { readDefaultSessionStoreDir } from "./paths.ts";

const METADATA_FILE = "metadata.json";
const EVENTS_FILE = "events.jsonl";
// Session directory names must be path-safe single segments.
const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

type TimestampInput = Date | string;

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

type SessionEventRole = "user" | "assistant" | "system" | "tool";

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

const readSessionDirectory = (options: SessionStoreOptions): string => {
  if (options.baseDir !== undefined) return options.baseDir;

  return readDefaultSessionStoreDir();
};

const readSessionPaths = (id: string, options: SessionStoreOptions): SessionPaths => {
  const safeId = cleanSessionId(id);
  const baseDir = readSessionDirectory(options);
  const sessionDir = join(baseDir, safeId);
  return {
    baseDir,
    sessionDir,
    metadataPath: join(sessionDir, METADATA_FILE),
    eventsPath: join(sessionDir, EVENTS_FILE),
  };
};

const readSessionClock = (options: SessionStoreOptions): (() => Date) => {
  if (options.now !== undefined) return options.now;

  return () => new Date();
};

const readNextSessionId = (options: SessionStoreOptions): (() => string) => {
  if (options.createId !== undefined) return options.createId;

  return randomUUID;
};

const cleanSessionId = (id: string): string => {
  const isUnsafeSessionId = !SAFE_SESSION_ID.test(id);
  if (isUnsafeSessionId) throw new Error(`Invalid session id: ${id}`);

  return id;
};

const cleanSessionEventId = (id: string): string => {
  const isIdInvalid = id.length === 0 || id.includes("\n") || id.includes("\r");
  if (isIdInvalid) {
    throw new Error("Invalid session event id");
  }

  return id;
};

const cleanTimestamp = (value: TimestampInput): string => {
  const isInstanceDate = value instanceof Date;
  if (isInstanceDate) {
    const iso = value.toISOString();
    const parsedTime = Date.parse(iso);
    const isInvalidIsoDate = Number.isNaN(parsedTime);
    if (isInvalidIsoDate) throw new Error(`Invalid timestamp: ${iso}`);

    return iso;
  }

  const parsedTime = Date.parse(value);
  const isInvalidDateValue = Number.isNaN(parsedTime);
  if (isInvalidDateValue) throw new Error(`Invalid timestamp: ${value}`);

  return value;
};

const readLatestTimestamp = (left: string, right: string): string => {
  const isLeftNewer = Date.parse(left) >= Date.parse(right);
  if (isLeftNewer) return left;

  return right;
};

const cleanContextLimit = (value: number): number => {
  const isNotPositiveNumber = !Number.isFinite(value) || value <= 0;
  if (isNotPositiveNumber) throw new Error(`Invalid context limit: ${value}`);

  return value;
};

const cleanRole = (role: string, source: string): SessionEventRole => {
  const isKnownRole =
    role === "user" || role === "assistant" || role === "system" || role === "tool";
  if (isKnownRole) return role;

  throw new Error(`Invalid role in ${source}: ${role}`);
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const readString = (record: Record<string, unknown>, key: string, source: string): string => {
  const value = record[key];
  const isTypeNotString = typeof value !== "string";
  if (isTypeNotString) throw new Error(`Expected ${key} to be a string in ${source}`);

  return value;
};

const readOptionalString = (
  record: Record<string, unknown>,
  key: string,
  source: string,
): string | undefined => {
  const value = record[key];
  const isValueUndefined = value === undefined;
  if (isValueUndefined) return undefined;

  const isTypeNotString = typeof value !== "string";
  if (isTypeNotString) throw new Error(`Expected ${key} to be a string in ${source}`);

  return value;
};

const readNullableString = (
  record: Record<string, unknown>,
  key: string,
  source: string,
): string | null => {
  const value = record[key];
  const isValueNull = value === null;
  if (isValueNull) return null;

  const isTypeNotString = typeof value !== "string";
  if (isTypeNotString) throw new Error(`Expected ${key} to be a string or null in ${source}`);

  return value;
};

const readNumber = (record: Record<string, unknown>, key: string, source: string): number => {
  const value = record[key];
  const isTypeNotNumber = typeof value !== "number";
  if (isTypeNotNumber) throw new Error(`Expected ${key} to be a number in ${source}`);

  return value;
};

const parseJsonObject = (raw: string, source: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(raw);
  const isNotParsed = !isRecord(parsed);
  if (isNotParsed) throw new Error(`Expected JSON object in ${source}`);

  return parsed;
};

const readMetadataFromObject = (
  record: Record<string, unknown>,
  source: string,
): SessionMetadata => {
  const sessionIdField = readString(record, "id", source);
  return {
    id: cleanSessionId(sessionIdField),
    repoPath: readString(record, "repoPath", source),
    model: readNullableString(record, "model", source),
    contextLimit: cleanContextLimit(readNumber(record, "contextLimit", source)),
    tunnelUrl: readNullableString(record, "tunnelUrl", source),
    startedAt: cleanTimestamp(readString(record, "startedAt", source)),
    updatedAt: cleanTimestamp(readString(record, "updatedAt", source)),
  };
};

const applyOptionalEventFields = (
  event: SessionEvent,
  record: Record<string, unknown>,
  source: string,
): void => {
  const role = readOptionalString(record, "role", source);

  const hasRole = role !== undefined;
  if (hasRole) event.role = cleanRole(role, source);

  for (const field of ["name", "status", "content"] as const) {
    const value = readOptionalString(record, field, source);
    const hasValue = value !== undefined;
    if (hasValue) event[field] = value;
  }

  const eventData = record.data;
  const isEventMissing = eventData === undefined;
  if (isEventMissing) return;

  const isNotEvent = !isRecord(eventData);
  if (isNotEvent) throw new Error(`Expected data to be an object in ${source}`);

  event.data = eventData;
};

const readEventFromObject = (record: Record<string, unknown>, source: string): SessionEvent => {
  const event: SessionEvent = {
    id: readString(record, "id", source),
    type: readString(record, "type", source),
    createdAt: cleanTimestamp(readString(record, "createdAt", source)),
  };
  applyOptionalEventFields(event, record, source);
  return event;
};

const readMetadata = async (path: string): Promise<SessionMetadata> => {
  const raw = await readFile(path, "utf-8");
  const metadataObject = parseJsonObject(raw, path);
  return readMetadataFromObject(metadataObject, path);
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
  const eventObject = parseJsonObject(line, source);
  return readEventFromObject(eventObject, source);
};

const readEvents = async (path: string): Promise<SessionEvent[]> => {
  const raw = await readRawEvents(path);
  const isRawBlank = raw.trim().length === 0;
  if (isRawBlank) return [];

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

const readSessionMetadata = (
  input: CreateSessionInput,
  options: SessionStoreOptions,
): SessionMetadata => {
  const id =
    input.id === undefined
      ? cleanSessionId(readNextSessionId(options)())
      : cleanSessionId(input.id);
  const startedAt =
    input.startedAt === undefined
      ? cleanTimestamp(readSessionClock(options)())
      : cleanTimestamp(input.startedAt);
  const updatedAt =
    input.updatedAt === undefined ? cleanTimestamp(startedAt) : cleanTimestamp(input.updatedAt);
  const model = input.model === undefined ? null : input.model;
  const tunnelUrl = input.tunnelUrl === undefined ? null : input.tunnelUrl;
  return {
    id,
    repoPath: input.repoPath,
    model,
    contextLimit: cleanContextLimit(input.contextLimit),
    tunnelUrl,
    startedAt,
    updatedAt,
  };
};

const readSessionEvent = (
  input: AppendSessionEventInput,
  options: SessionStoreOptions,
): SessionEvent => {
  const id =
    input.id === undefined
      ? cleanSessionEventId(readNextSessionId(options)())
      : cleanSessionEventId(input.id);
  const createdAt =
    input.createdAt === undefined
      ? cleanTimestamp(readSessionClock(options)())
      : cleanTimestamp(input.createdAt);
  const event: SessionEvent = {
    id,
    type: input.type,
    createdAt,
  };

  if (input.role !== undefined) event.role = input.role;

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
      ? cleanTimestamp(readSessionClock(options)())
      : cleanTimestamp(input.updatedAt);
  return {
    id: current.id,
    repoPath: input.repoPath === undefined ? current.repoPath : input.repoPath,
    model: input.model === undefined ? current.model : input.model,
    contextLimit:
      input.contextLimit === undefined
        ? current.contextLimit
        : cleanContextLimit(input.contextLimit),
    tunnelUrl: input.tunnelUrl === undefined ? current.tunnelUrl : input.tunnelUrl,
    startedAt: current.startedAt,
    updatedAt,
  };
};

const initSessionDir = async (
  metadata: SessionMetadata,
  options: SessionStoreOptions,
): Promise<void> => {
  const paths = readSessionPaths(metadata.id, options);
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
    updatedAt: readLatestTimestamp(input.metadata.updatedAt, input.event.createdAt),
  });
};

const tryReadSessionMetadata = async (
  baseDir: string,
  entry: Dirent,
): Promise<SessionMetadata | undefined> => {
  const isUnsafeSessionEntry = !entry.isDirectory() || !SAFE_SESSION_ID.test(entry.name);
  if (isUnsafeSessionEntry) return undefined;

  try {
    const metadataPath = join(baseDir, entry.name, METADATA_FILE);
    return await readMetadata(metadataPath);
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

    const hasMetadata = metadata !== undefined;
    if (hasMetadata) sessions.push(metadata);
  }
  return sessions;
};

const sortSessionsByActivity = (sessions: SessionMetadata[]): SessionMetadata[] => {
  return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
};

const readEventDetail = (event: SessionEvent): string => {
  if (event.content !== undefined) return event.content;

  if (event.data !== undefined) return JSON.stringify(event.data);

  return "";
};

const writeMessageTranscript = (event: SessionEvent, prefix: string): string => {
  const role = event.role === undefined ? "message" : event.role;
  const content = event.content === undefined ? "" : event.content;
  return `${prefix} ${role}: ${content}`;
};

const readTranscriptFieldSuffix = (value: string | undefined): string => {
  const isFieldBlank = value === undefined || value.length === 0;
  if (isFieldBlank) return "";

  return ` ${value}`;
};

const writeActionTranscript = (event: SessionEvent, prefix: string): string => {
  const name = readTranscriptFieldSuffix(event.name);
  const status = readTranscriptFieldSuffix(event.status);
  const detail = readEventDetail(event);

  const isDetailEmpty = detail.length === 0;
  if (isDetailEmpty) return `${prefix} action${name}${status}`;

  return `${prefix} action${name}${status}: ${detail}`;
};

const writeGenericTranscript = (event: SessionEvent, prefix: string): string => {
  const labelParts = [event.type, event.name, event.status].filter(
    (part): part is string => part !== undefined && part.length > 0,
  );
  const label = labelParts.join(" ");
  const detail = readEventDetail(event);

  const isDetailEmpty = detail.length === 0;
  if (isDetailEmpty) return `${prefix} ${label}`;

  return `${prefix} ${label}: ${detail}`;
};

const writeTranscriptEvent = (event: SessionEvent): string => {
  const prefix = `[${event.createdAt}]`;

  const isEventTypeMessage = event.type === "message";
  if (isEventTypeMessage) return writeMessageTranscript(event, prefix);

  const isEventTypeAction = event.type === "action";
  if (isEventTypeAction) return writeActionTranscript(event, prefix);

  return writeGenericTranscript(event, prefix);
};

const writeTranscript = (events: SessionEvent[]): string => {
  return events.map(writeTranscriptEvent).join("\n");
};

export const createSession = async (
  input: CreateSessionInput,
  options: SessionStoreOptions = {},
): Promise<SessionRecord> => {
  const metadata = readSessionMetadata(input, options);
  await initSessionDir(metadata, options);
  return { metadata, events: [] };
};

export const loadSession = async (
  id: string,
  options: SessionStoreOptions = {},
): Promise<SessionRecord> => {
  const paths = readSessionPaths(id, options);
  return {
    metadata: await readMetadata(paths.metadataPath),
    events: await readEvents(paths.eventsPath),
  };
};

export const listSessions = async (
  options: SessionStoreOptions = {},
): Promise<SessionMetadata[]> => {
  const baseDir = readSessionDirectory(options);
  const sessionDirEntries = await readSessionDirEntries(baseDir);
  const sessions = await collectSessionMetadata(baseDir, sessionDirEntries);
  return sortSessionsByActivity(sessions);
};

export const appendSessionEvent = async (
  sessionId: string,
  input: AppendSessionEventInput,
  options: SessionStoreOptions = {},
): Promise<SessionEvent> => {
  const paths = readSessionPaths(sessionId, options);
  const metadata = await readMetadata(paths.metadataPath);
  const event = readSessionEvent(input, options);
  await persistAppendedEvent({ paths, metadata, event });
  return event;
};

export const updateSession = async (
  sessionId: string,
  input: UpdateSessionInput,
  options: SessionStoreOptions = {},
): Promise<SessionMetadata> => {
  const paths = readSessionPaths(sessionId, options);
  const storedMetadata = await readMetadata(paths.metadataPath);
  const next = mergeSessionMetadata(storedMetadata, input, options);
  await writeMetadata(paths.metadataPath, next);
  return next;
};

export const exportSession = async (
  sessionId: string,
  options: SessionStoreOptions = {},
): Promise<SessionExport> => {
  const record = await loadSession(sessionId, options);
  const jsonl = await readRawEvents(readSessionPaths(sessionId, options).eventsPath);
  return {
    ...record,
    transcript: writeTranscript(record.events),
    json: `${JSON.stringify(record, null, 2)}\n`,
    jsonl,
  };
};

export const getLatestSession = async (
  options: SessionStoreOptions = {},
): Promise<SessionRecord | null> => {
  const baseDir = readSessionDirectory(options);
  const entries = await readSessionDirEntries(baseDir);
  const sessionMetadataList = await collectSessionMetadata(baseDir, entries);
  const [latest] = sortSessionsByActivity(sessionMetadataList);

  const isLatestMissing = latest === undefined;
  if (isLatestMissing) return null;

  const paths = readSessionPaths(latest.id, options);
  return { metadata: latest, events: await readEvents(paths.eventsPath) };
};
