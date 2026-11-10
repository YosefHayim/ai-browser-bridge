import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hasErrorCode } from "@/domain/errors.ts";
import { readDefaultSessionStoreDirectory } from "./paths.ts";

const INDENT_SPACES = 2;

const UTF8_ENCODING = "utf-8";

const ENOENT_ERROR_CODE = "ENOENT";

const METADATA_FILE = "metadata.json";
const EVENTS_FILE = "events.jsonl";
// Session directory names must be path-safe single segments.
const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const MESSAGE_EVENT_TYPE = "message";

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
  return settings.baseDir ?? readDefaultSessionStoreDirectory();
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
  return settings.now ?? (() => new Date());
};

const readNextSessionId = (settings: SessionStoreSettings): (() => string) => {
  return settings.createId ?? randomUUID;
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

  const isInvalidDate = Number.isNaN(parsedTime);
  if (isInvalidDate) throw new Error(`Invalid timestamp: ${field}`);

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
): string | null => {
  const field = plainObject[key];

  const isPropertyUndefined = field === undefined;
  if (isPropertyUndefined) return null;

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

  const isPropertyNull = field === null;
  if (isPropertyNull) return null;

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
  const repoPathField = readString(plainObject, "repoPath", origin);
  const modelField = readNullableString(plainObject, "model", origin);
  const contextLimitField = readNumber(plainObject, "contextLimit", origin);
  const tunnelUrlField = readNullableString(plainObject, "tunnelUrl", origin);
  const startedAtField = readString(plainObject, "startedAt", origin);
  const updatedAtField = readString(plainObject, "updatedAt", origin);

  return {
    id: cleanSessionId(sessionIdField),
    repoPath: repoPathField,
    model: modelField,
    contextLimit: cleanTokenLimit(contextLimitField),
    tunnelUrl: tunnelUrlField,
    startedAt: cleanTimestamp(startedAtField),
    updatedAt: cleanTimestamp(updatedAtField),
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
    const stringSetting = readOptionalString(plainObject, field, origin);

    const hasStringSetting = stringSetting != null;
    if (hasStringSetting) event[field] = stringSetting;
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
  const idField = readString(plainObject, "id", origin);
  const typeField = readString(plainObject, "type", origin);
  const createdAtField = readString(plainObject, "createdAt", origin);

  const event: SessionEvent = {
    id: idField,
    type: typeField,
    createdAt: cleanTimestamp(createdAtField),
  };

  applyOptionalEventFields(event, plainObject, origin);

  return event;
};

const readMetadata = async (path: string): Promise<SessionMetadata> => {
  const unparsed = await readFile(path, UTF8_ENCODING);
  const metadataObject = parseDocumentObject(unparsed, path);
  return readMetadataFromObject(metadataObject, path);
};

const readUnparsedEvents = async (path: string): Promise<string> => {
  try {
    return await readFile(path, UTF8_ENCODING);
  } catch (error) {
    if (hasErrorCode(error, ENOENT_ERROR_CODE)) return "";

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
  await writeFile(path, `${JSON.stringify(metadata, null, INDENT_SPACES)}\n`, UTF8_ENCODING);
};

const readSessionDirectoryListing = async (baseDirectory: string): Promise<Dirent[]> => {
  try {
    return await readdir(baseDirectory, { withFileTypes: true });
  } catch (error) {
    if (hasErrorCode(error, ENOENT_ERROR_CODE)) return [];

    throw error;
  }
};

const pickSessionId = (idField: string | undefined, settings: SessionStoreSettings): string => {
  const isIdMissing = idField == null;
  if (isIdMissing) return cleanSessionId(readNextSessionId(settings)());

  return cleanSessionId(idField);
};

const pickSessionEventId = (
  idField: string | undefined,
  settings: SessionStoreSettings,
): string => {
  const isIdMissing = idField == null;
  if (isIdMissing) return cleanSessionEventId(readNextSessionId(settings)());

  return cleanSessionEventId(idField);
};

const pickTimestampOrClock = (
  timestampField: TimestampDetails | undefined,
  settings: SessionStoreSettings,
): string => {
  const isTimestampMissing = timestampField == null;
  if (isTimestampMissing) return cleanTimestamp(readSessionClock(settings)());

  return cleanTimestamp(timestampField);
};

const pickTimestampOrFallback = (
  timestampField: TimestampDetails | undefined,
  fallbackTimestamp: string,
): string => {
  const isTimestampMissing = timestampField == null;
  if (isTimestampMissing) return cleanTimestamp(fallbackTimestamp);

  return cleanTimestamp(timestampField);
};

const pickValueOrNull = (value: string | null | undefined): string | null => {
  const isValueMissing = value === undefined;
  if (isValueMissing) return null;

  return value;
};

const pickValueOrCurrent = (
  value: string | null | undefined,
  currentValue: string | null,
): string | null => {
  const isValueMissing = value === undefined;
  if (isValueMissing) return currentValue;

  return value;
};

const readSessionMetadata = (
  details: CreateSessionDetails,
  settings: SessionStoreSettings,
): SessionMetadata => {
  const id = pickSessionId(details.id, settings);
  const startedAt = pickTimestampOrClock(details.startedAt, settings);
  const updatedAt = pickTimestampOrFallback(details.updatedAt, startedAt);

  return {
    id,
    repoPath: details.repoPath,
    model: pickValueOrNull(details.model),
    contextLimit: cleanTokenLimit(details.contextLimit),
    tunnelUrl: pickValueOrNull(details.tunnelUrl),
    startedAt,
    updatedAt,
  };
};

const readSessionEvent = (
  details: AppendSessionEventDetails,
  settings: SessionStoreSettings,
): SessionEvent => {
  const id = pickSessionEventId(details.id, settings);
  const createdAt = pickTimestampOrClock(details.createdAt, settings);
  const event: SessionEvent = {
    id,
    type: details.type,
    createdAt,
  };

  const roleField = details.role;
  const hasDetailsRole = roleField != null;
  if (hasDetailsRole) event.role = roleField;

  const nameField = details.name;
  const hasDetailsName = nameField != null;
  if (hasDetailsName) event.name = nameField;

  const statusField = details.status;
  const hasDetailsStatus = statusField != null;
  if (hasDetailsStatus) event.status = statusField;

  const contentField = details.content;
  const hasDetailsContent = contentField != null;
  if (hasDetailsContent) event.content = contentField;

  const dataField = details.data;
  const hasDetailsData = dataField != null;
  if (hasDetailsData) event.data = dataField;

  return event;
};

const mergeSessionMetadata = (
  current: SessionMetadata,
  details: UpdateSessionDetails,
  settings: SessionStoreSettings,
): SessionMetadata => {
  const updatedAt = pickTimestampOrClock(details.updatedAt, settings);
  const contextLimitField = details.contextLimit;
  const isContextLimitMissing = contextLimitField == null;
  const repoPathField = details.repoPath;
  const isRepoPathMissing = repoPathField == null;

  return {
    id: current.id,
    repoPath: isRepoPathMissing ? current.repoPath : repoPathField,
    model: pickValueOrCurrent(details.model, current.model),
    contextLimit: isContextLimitMissing ? current.contextLimit : cleanTokenLimit(contextLimitField),
    tunnelUrl: pickValueOrCurrent(details.tunnelUrl, current.tunnelUrl),
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
  await writeFile(paths.eventsPath, "", UTF8_ENCODING);
};

const persistAppendedEvent = async (details: {
  paths: SessionPaths;
  metadata: SessionMetadata;
  event: SessionEvent;
}): Promise<void> => {
  await appendFile(details.paths.eventsPath, `${JSON.stringify(details.event)}\n`, UTF8_ENCODING);
  await writeMetadata(details.paths.metadataPath, {
    ...details.metadata,
    updatedAt: readLatestTimestamp(details.metadata.updatedAt, details.event.createdAt),
  });
};

const tryReadSessionMetadata = async (
  baseDirectory: string,
  line: Dirent,
): Promise<SessionMetadata | null> => {
  const isUnsafeSessionFolder = !line.isDirectory() || !SAFE_SESSION_ID.test(line.name);
  if (isUnsafeSessionFolder) return null;

  try {
    const metadataPath = join(baseDirectory, line.name, METADATA_FILE);
    return await readMetadata(metadataPath);
  } catch (error) {
    if (hasErrorCode(error, ENOENT_ERROR_CODE)) return null;

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
  const contentField = event.content;
  const hasContent = contentField != null;
  if (hasContent) return contentField;

  const dataField = event.data;
  const hasData = dataField != null;
  if (hasData) return JSON.stringify(dataField);

  return "";
};

const writeMessageTranscript = (event: SessionEvent, prefix: string): string => {
  const roleField = event.role;
  const isRoleMissing = roleField == null;
  const role = isRoleMissing ? MESSAGE_EVENT_TYPE : roleField;

  const contentField = event.content;
  const isContentMissing = contentField == null;
  const message = isContentMissing ? "" : contentField;

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

  const isEventTypeMessage = event.type === MESSAGE_EVENT_TYPE;
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
  const metadata = await readMetadata(paths.metadataPath);
  const events = await readEvents(paths.eventsPath);

  return { metadata, events };
};

export const listSessions = async (
  settings: SessionStoreSettings = {},
): Promise<SessionMetadata[]> => {
  const baseDirectory = readSessionDirectory(settings);
  const sessionDirectoryListing = await readSessionDirectoryListing(baseDirectory);
  const sessions = await collectSessionMetadata(baseDirectory, sessionDirectoryListing);
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
    json: `${JSON.stringify(plainObject, null, INDENT_SPACES)}\n`,
    jsonl,
  };
};

export const getLatestSession = async (
  settings: SessionStoreSettings = {},
): Promise<StoredSession | null> => {
  const baseDirectory = readSessionDirectory(settings);
  const lines = await readSessionDirectoryListing(baseDirectory);
  const sessionMetadataList = await collectSessionMetadata(baseDirectory, lines);
  const [latest] = sortSessionsByActivity(sessionMetadataList);

  const isLatestMissing = latest == null;
  if (isLatestMissing) return null;

  const paths = readSessionPaths(latest.id, settings);
  const events = await readEvents(paths.eventsPath);

  return { metadata: latest, events };
};
