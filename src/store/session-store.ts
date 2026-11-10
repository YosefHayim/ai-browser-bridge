import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hasErrorCode } from "@/domain/errors.ts";
import { readDefaultSessionStoreDirectory } from "./paths.ts";

const METADATA_FILE = "metadata.json";
const EVENTS_FILE = "events.jsonl";
// Session directory names must be path-safe single segments.
const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

type TimestampDetails = Date | string;

export type SessionStoreSettings = {
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

export type StoredSession = {
  metadata: SessionMetadata;
  events: SessionEvent[];
};

export type CreateSessionDetails = {
  id?: string;
  repoPath: string;
  model?: string | null;
  contextLimit: number;
  tunnelUrl?: string | null;
  startedAt?: TimestampDetails;
  updatedAt?: TimestampDetails;
};

export type UpdateSessionDetails = {
  repoPath?: string;
  model?: string | null;
  contextLimit?: number;
  tunnelUrl?: string | null;
  updatedAt?: TimestampDetails;
};

export type AppendSessionEventDetails = {
  id?: string;
  type: string;
  createdAt?: TimestampDetails;
  role?: SessionEventRole;
  name?: string;
  status?: string;
  content?: string;
  data?: Record<string, unknown>;
};

export type SessionExport = StoredSession & {
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

const readSessionDirectory = (settings: SessionStoreSettings): string => {
  if (settings.baseDir != null) return settings.baseDir;

  return readDefaultSessionStoreDirectory();
};

const readSessionPaths = (id: string, settings: SessionStoreSettings): SessionPaths => {
  const safeId = cleanSessionId(id);
  const baseDirectory = readSessionDirectory(settings);
  const sessionDirectory = join(baseDirectory, safeId);
  return {
    baseDir: baseDirectory,
    sessionDir: sessionDirectory,
    metadataPath: join(sessionDirectory, METADATA_FILE),
    eventsPath: join(sessionDirectory, EVENTS_FILE),
  };
};

const readSessionClock = (settings: SessionStoreSettings): (() => Date) => {
  if (settings.now != null) return settings.now;

  return () => new Date();
};

const readNextSessionId = (settings: SessionStoreSettings): (() => string) => {
  if (settings.createId != null) return settings.createId;

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

const cleanTimestamp = (field: TimestampDetails): string => {
  const isInstanceDate = field instanceof Date;
  if (isInstanceDate) {
    const iso = field.toISOString();
    const parsedTime = Date.parse(iso);
    const isInvalidIsoDate = Number.isNaN(parsedTime);
    if (isInvalidIsoDate) throw new Error(`Invalid timestamp: ${iso}`);

    return iso;
  }

  const parsedTime = Date.parse(field);
  const isInvalidDateField = Number.isNaN(parsedTime);
  if (isInvalidDateField) throw new Error(`Invalid timestamp: ${field}`);

  return field;
};

const readLatestTimestamp = (left: string, right: string): string => {
  const isLeftNewer = Date.parse(left) >= Date.parse(right);
  if (isLeftNewer) return left;

  return right;
};

const cleanTokenLimit = (field: number): number => {
  const isNotPositiveNumber = !Number.isFinite(field) || field <= 0;
  if (isNotPositiveNumber) throw new Error(`Invalid context limit: ${field}`);

  return field;
};

const cleanRole = (role: string, origin: string): SessionEventRole => {
  const isKnownRole =
    role === "user" || role === "assistant" || role === "system" || role === "tool";
  if (isKnownRole) return role;

  throw new Error(`Invalid role in ${origin}: ${role}`);
};

const isPlainObject = (field: unknown): field is Record<string, unknown> => {
  return typeof field === "object" && field !== null && !Array.isArray(field);
};

const readString = (plainObject: Record<string, unknown>, key: string, origin: string): string => {
  const field = plainObject[key];
  const isTypeNotString = typeof field !== "string";
  if (isTypeNotString) throw new Error(`Expected ${key} to be a string in ${origin}`);

  return field;
};

const readOptionalString = (
  plainObject: Record<string, unknown>,
  key: string,
  origin: string,
): string | undefined => {
  const field = plainObject[key];
  const isFieldUndefined = field === undefined;
  if (isFieldUndefined) return undefined;

  const isTypeNotString = typeof field !== "string";
  if (isTypeNotString) throw new Error(`Expected ${key} to be a string in ${origin}`);

  return field;
};

const readNullableString = (
  plainObject: Record<string, unknown>,
  key: string,
  origin: string,
): string | null => {
  const field = plainObject[key];
  const isFieldNull = field === null;
  if (isFieldNull) return null;

  const isTypeNotString = typeof field !== "string";
  if (isTypeNotString) throw new Error(`Expected ${key} to be a string or null in ${origin}`);

  return field;
};

const readNumber = (plainObject: Record<string, unknown>, key: string, origin: string): number => {
  const field = plainObject[key];
  const isTypeNotNumber = typeof field !== "number";
  if (isTypeNotNumber) throw new Error(`Expected ${key} to be a number in ${origin}`);

  return field;
};

const parseDocumentObject = (unparsed: string, origin: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(unparsed);
  const isNotParsed = !isPlainObject(parsed);
  if (isNotParsed) throw new Error(`Expected JSON object in ${origin}`);

  return parsed;
};

const readMetadataFromObject = (
  plainObject: Record<string, unknown>,
  origin: string,
): SessionMetadata => {
  const sessionIdField = readString(plainObject, "id", origin);
  return {
    id: cleanSessionId(sessionIdField),
    repoPath: readString(plainObject, "repoPath", origin),
    model: readNullableString(plainObject, "model", origin),
    contextLimit: cleanTokenLimit(readNumber(plainObject, "contextLimit", origin)),
    tunnelUrl: readNullableString(plainObject, "tunnelUrl", origin),
    startedAt: cleanTimestamp(readString(plainObject, "startedAt", origin)),
    updatedAt: cleanTimestamp(readString(plainObject, "updatedAt", origin)),
  };
};

const applyOptionalEventFields = (
  event: SessionEvent,
  plainObject: Record<string, unknown>,
  origin: string,
): void => {
  const role = readOptionalString(plainObject, "role", origin);

  const hasRole = role != null;
  if (hasRole) event.role = cleanRole(role, origin);

  for (const field of ["name", "status", "content"] as const) {
    const fieldString = readOptionalString(plainObject, field, origin);
    const hasField = fieldString != null;
    if (hasField) event[field] = fieldString;
  }

  const eventDetails = plainObject.data;
  const isEventMissing = eventDetails === undefined;
  if (isEventMissing) return;

  const isNotEvent = !isPlainObject(eventDetails);
  if (isNotEvent) throw new Error(`Expected data to be an object in ${origin}`);

  event.data = eventDetails;
};

const readEventFromObject = (
  plainObject: Record<string, unknown>,
  origin: string,
): SessionEvent => {
  const event: SessionEvent = {
    id: readString(plainObject, "id", origin),
    type: readString(plainObject, "type", origin),
    createdAt: cleanTimestamp(readString(plainObject, "createdAt", origin)),
  };
  applyOptionalEventFields(event, plainObject, origin);
  return event;
};

const readMetadata = async (path: string): Promise<SessionMetadata> => {
  const unparsed = await readFile(path, "utf-8");
  const metadataObject = parseDocumentObject(unparsed, path);
  return readMetadataFromObject(metadataObject, path);
};

const readUnparsedEvents = async (path: string): Promise<string> => {
  try {
    return await readFile(path, "utf-8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return "";

    throw error;
  }
};

const parseEventLine = (line: string, path: string): SessionEvent => {
  const origin = `${path}:${line.length}`;
  const eventObject = parseDocumentObject(line, origin);
  return readEventFromObject(eventObject, origin);
};

const readEvents = async (path: string): Promise<SessionEvent[]> => {
  const unparsed = await readUnparsedEvents(path);
  const isUnparsedBlank = unparsed.trim().length === 0;
  if (isUnparsedBlank) return [];

  return unparsed
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => parseEventLine(line, path));
};

const writeMetadata = async (path: string, metadata: SessionMetadata): Promise<void> => {
  await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");
};

const readSessionDirectoryLines = async (baseDirectory: string): Promise<Dirent[]> => {
  try {
    return await readdir(baseDirectory, { withFileTypes: true });
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return [];

    throw error;
  }
};

const readSessionMetadata = (
  details: CreateSessionDetails,
  settings: SessionStoreSettings,
): SessionMetadata => {
  const id =
    details.id == null ? cleanSessionId(readNextSessionId(settings)()) : cleanSessionId(details.id);
  const startedAt =
    details.startedAt == null
      ? cleanTimestamp(readSessionClock(settings)())
      : cleanTimestamp(details.startedAt);
  const updatedAt =
    details.updatedAt == null ? cleanTimestamp(startedAt) : cleanTimestamp(details.updatedAt);
  const model = details.model === undefined ? null : details.model;
  const tunnelUrl = details.tunnelUrl === undefined ? null : details.tunnelUrl;
  return {
    id,
    repoPath: details.repoPath,
    model,
    contextLimit: cleanTokenLimit(details.contextLimit),
    tunnelUrl,
    startedAt,
    updatedAt,
  };
};

const readSessionEvent = (
  details: AppendSessionEventDetails,
  settings: SessionStoreSettings,
): SessionEvent => {
  const id =
    details.id == null
      ? cleanSessionEventId(readNextSessionId(settings)())
      : cleanSessionEventId(details.id);
  const createdAt =
    details.createdAt == null
      ? cleanTimestamp(readSessionClock(settings)())
      : cleanTimestamp(details.createdAt);
  const event: SessionEvent = {
    id,
    type: details.type,
    createdAt,
  };

  if (details.role != null) event.role = details.role;

  if (details.name != null) event.name = details.name;

  if (details.status != null) event.status = details.status;

  if (details.content != null) event.content = details.content;

  if (details.data != null) event.data = details.data;

  return event;
};

const mergeSessionMetadata = (
  current: SessionMetadata,
  details: UpdateSessionDetails,
  settings: SessionStoreSettings,
): SessionMetadata => {
  const updatedAt =
    details.updatedAt == null
      ? cleanTimestamp(readSessionClock(settings)())
      : cleanTimestamp(details.updatedAt);
  return {
    id: current.id,
    repoPath: details.repoPath == null ? current.repoPath : details.repoPath,
    model: details.model === undefined ? current.model : details.model,
    contextLimit:
      details.contextLimit == null ? current.contextLimit : cleanTokenLimit(details.contextLimit),
    tunnelUrl: details.tunnelUrl === undefined ? current.tunnelUrl : details.tunnelUrl,
    startedAt: current.startedAt,
    updatedAt,
  };
};

const initSessionDirectory = async (
  metadata: SessionMetadata,
  settings: SessionStoreSettings,
): Promise<void> => {
  const paths = readSessionPaths(metadata.id, settings);
  await mkdir(paths.baseDir, { recursive: true });
  await mkdir(paths.sessionDir);
  await writeMetadata(paths.metadataPath, metadata);
  await writeFile(paths.eventsPath, "", "utf-8");
};

const persistAppendedEvent = async (details: {
  paths: SessionPaths;
  metadata: SessionMetadata;
  event: SessionEvent;
}): Promise<void> => {
  await appendFile(details.paths.eventsPath, `${JSON.stringify(details.event)}\n`, "utf-8");
  await writeMetadata(details.paths.metadataPath, {
    ...details.metadata,
    updatedAt: readLatestTimestamp(details.metadata.updatedAt, details.event.createdAt),
  });
};

const tryReadSessionMetadata = async (
  baseDirectory: string,
  line: Dirent,
): Promise<SessionMetadata | null> => {
  const isUnsafeSessionLine = !line.isDirectory() || !SAFE_SESSION_ID.test(line.name);
  if (isUnsafeSessionLine) return null;

  try {
    const metadataPath = join(baseDirectory, line.name, METADATA_FILE);
    return await readMetadata(metadataPath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;

    throw error;
  }
};

const collectSessionMetadata = async (
  baseDirectory: string,
  lines: Dirent[],
): Promise<SessionMetadata[]> => {
  const sessions: SessionMetadata[] = [];
  for (const line of lines) {
    const metadata = await tryReadSessionMetadata(baseDirectory, line);

    const hasMetadata = metadata != null;
    if (hasMetadata) sessions.push(metadata);
  }
  return sessions;
};

const sortSessionsByActivity = (sessions: SessionMetadata[]): SessionMetadata[] => {
  return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
};

const readEventDetail = (event: SessionEvent): string => {
  if (event.content != null) return event.content;

  if (event.data != null) return JSON.stringify(event.data);

  return "";
};

const writeMessageTranscript = (event: SessionEvent, prefix: string): string => {
  const role = event.role == null ? "message" : event.role;
  const message = event.content == null ? "" : event.content;
  return `${prefix} ${role}: ${message}`;
};

const readTranscriptFieldSuffix = (field: string | undefined): string => {
  const isFieldBlank = field == null || field.length === 0;
  if (isFieldBlank) return "";

  return ` ${field}`;
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
    (part): part is string => part != null && part.length > 0,
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
  details: CreateSessionDetails,
  settings: SessionStoreSettings = {},
): Promise<StoredSession> => {
  const metadata = readSessionMetadata(details, settings);
  await initSessionDirectory(metadata, settings);
  return { metadata, events: [] };
};

export const loadSession = async (
  id: string,
  settings: SessionStoreSettings = {},
): Promise<StoredSession> => {
  const paths = readSessionPaths(id, settings);
  return {
    metadata: await readMetadata(paths.metadataPath),
    events: await readEvents(paths.eventsPath),
  };
};

export const listSessions = async (
  settings: SessionStoreSettings = {},
): Promise<SessionMetadata[]> => {
  const baseDirectory = readSessionDirectory(settings);
  const sessionDirectoryLines = await readSessionDirectoryLines(baseDirectory);
  const sessions = await collectSessionMetadata(baseDirectory, sessionDirectoryLines);
  return sortSessionsByActivity(sessions);
};

export const appendSessionEvent = async (
  sessionId: string,
  details: AppendSessionEventDetails,
  settings: SessionStoreSettings = {},
): Promise<SessionEvent> => {
  const paths = readSessionPaths(sessionId, settings);
  const metadata = await readMetadata(paths.metadataPath);
  const event = readSessionEvent(details, settings);
  await persistAppendedEvent({ paths, metadata, event });
  return event;
};

export const updateSession = async (
  sessionId: string,
  details: UpdateSessionDetails,
  settings: SessionStoreSettings = {},
): Promise<SessionMetadata> => {
  const paths = readSessionPaths(sessionId, settings);
  const storedMetadata = await readMetadata(paths.metadataPath);
  const next = mergeSessionMetadata(storedMetadata, details, settings);
  await writeMetadata(paths.metadataPath, next);
  return next;
};

export const exportSession = async (
  sessionId: string,
  settings: SessionStoreSettings = {},
): Promise<SessionExport> => {
  const plainObject = await loadSession(sessionId, settings);
  const jsonl = await readUnparsedEvents(readSessionPaths(sessionId, settings).eventsPath);
  return {
    ...plainObject,
    transcript: writeTranscript(plainObject.events),
    json: `${JSON.stringify(plainObject, null, 2)}\n`,
    jsonl,
  };
};

export const getLatestSession = async (
  settings: SessionStoreSettings = {},
): Promise<StoredSession | null> => {
  const baseDirectory = readSessionDirectory(settings);
  const lines = await readSessionDirectoryLines(baseDirectory);
  const sessionMetadataList = await collectSessionMetadata(baseDirectory, lines);
  const [latest] = sortSessionsByActivity(sessionMetadataList);

  const isLatestMissing = latest == null;
  if (isLatestMissing) return null;

  const paths = readSessionPaths(latest.id, settings);
  return { metadata: latest, events: await readEvents(paths.eventsPath) };
};
