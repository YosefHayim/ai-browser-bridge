import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hasErrorCode } from "./errors.ts";
import { sessionsDir } from "./paths.ts";

const METADATA_FILE = "metadata.json";
const EVENTS_FILE = "events.jsonl";
const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

type TimestampInput = Date | string;

export interface SessionStoreOptions {
  /** Defaults to `<cwd>/.bridge/sessions`. Callers with a target repo pass `sessionsDir(repoPath)`; tests pass a temp dir. */
  baseDir?: string;
  now?: () => Date;
  createId?: () => string;
}

export interface SessionMetadata {
  id: string;
  repoPath: string;
  model: string | null;
  contextLimit: number;
  tunnelUrl: string | null;
  startedAt: string;
  updatedAt: string;
}

export interface CreateSessionInput {
  id?: string;
  repoPath: string;
  model?: string | null;
  contextLimit: number;
  tunnelUrl?: string | null;
  startedAt?: TimestampInput;
  updatedAt?: TimestampInput;
}

export interface UpdateSessionInput {
  repoPath?: string;
  model?: string | null;
  contextLimit?: number;
  tunnelUrl?: string | null;
  updatedAt?: TimestampInput;
}

export type SessionEventRole = "user" | "assistant" | "system" | "tool";

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

export interface SessionRecord {
  metadata: SessionMetadata;
  events: SessionEvent[];
}

export interface SessionExport extends SessionRecord {
  transcript: string;
  json: string;
  jsonl: string;
}

export function defaultSessionStoreDir(): string {
  return sessionsDir(process.cwd());
}

export async function createSession(
  input: CreateSessionInput,
  options: SessionStoreOptions = {},
): Promise<SessionRecord> {
  const id = normalizeSessionId(input.id ?? getCreateId(options)());
  const startedAt = normalizeTimestamp(input.startedAt ?? getNow(options)());
  const updatedAt = normalizeTimestamp(input.updatedAt ?? startedAt);
  const metadata: SessionMetadata = {
    id,
    repoPath: input.repoPath,
    model: input.model ?? null,
    contextLimit: normalizeContextLimit(input.contextLimit),
    tunnelUrl: input.tunnelUrl ?? null,
    startedAt,
    updatedAt,
  };
  const paths = sessionPaths(id, options);

  await mkdir(paths.baseDir, { recursive: true });
  await mkdir(paths.sessionDir);
  await writeMetadata(paths.metadataPath, metadata);
  await writeFile(paths.eventsPath, "", "utf-8");

  return { metadata, events: [] };
}

export async function loadSession(
  id: string,
  options: SessionStoreOptions = {},
): Promise<SessionRecord> {
  const paths = sessionPaths(id, options);
  const metadata = await readMetadata(paths.metadataPath);
  const events = await readEvents(paths.eventsPath);

  return { metadata, events };
}

export async function listSessions(options: SessionStoreOptions = {}): Promise<SessionMetadata[]> {
  const baseDir = resolveBaseDir(options);
  let entries;

  try {
    entries = await readdir(baseDir, { withFileTypes: true });
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return [];
    throw error;
  }

  const sessions: SessionMetadata[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !SAFE_SESSION_ID.test(entry.name)) continue;

    try {
      sessions.push(await readMetadata(join(baseDir, entry.name, METADATA_FILE)));
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) continue;
      throw error;
    }
  }

  return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function appendSessionEvent(
  sessionId: string,
  input: AppendSessionEventInput,
  options: SessionStoreOptions = {},
): Promise<SessionEvent> {
  const paths = sessionPaths(sessionId, options);
  const metadata = await readMetadata(paths.metadataPath);
  const event: SessionEvent = {
    id: normalizeSessionEventId(input.id ?? getCreateId(options)()),
    type: input.type,
    createdAt: normalizeTimestamp(input.createdAt ?? getNow(options)()),
    ...(input.role ? { role: input.role } : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.content !== undefined ? { content: input.content } : {}),
    ...(input.data !== undefined ? { data: input.data } : {}),
  };

  await appendFile(paths.eventsPath, `${JSON.stringify(event)}\n`, "utf-8");
  await writeMetadata(paths.metadataPath, {
    ...metadata,
    updatedAt: latestTimestamp(metadata.updatedAt, event.createdAt),
  });

  return event;
}

export async function updateSession(
  sessionId: string,
  input: UpdateSessionInput,
  options: SessionStoreOptions = {},
): Promise<SessionMetadata> {
  const paths = sessionPaths(sessionId, options);
  const current = await readMetadata(paths.metadataPath);
  const next: SessionMetadata = {
    ...current,
    ...(input.repoPath !== undefined ? { repoPath: input.repoPath } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.contextLimit !== undefined ? { contextLimit: normalizeContextLimit(input.contextLimit) } : {}),
    ...(input.tunnelUrl !== undefined ? { tunnelUrl: input.tunnelUrl } : {}),
    updatedAt: normalizeTimestamp(input.updatedAt ?? getNow(options)()),
  };

  await writeMetadata(paths.metadataPath, next);
  return next;
}

export async function exportSession(
  sessionId: string,
  options: SessionStoreOptions = {},
): Promise<SessionExport> {
  const paths = sessionPaths(sessionId, options);
  const record = await loadSession(sessionId, options);
  const jsonl = await readRawEvents(paths.eventsPath);

  return {
    ...record,
    transcript: formatTranscript(record.events),
    json: `${JSON.stringify(record, null, 2)}\n`,
    jsonl,
  };
}

export async function getLatestSession(
  options: SessionStoreOptions = {},
): Promise<SessionRecord | null> {
  const [latest] = await listSessions(options);
  if (!latest) return null;

  return loadSession(latest.id, options);
}

function sessionPaths(id: string, options: SessionStoreOptions): {
  baseDir: string;
  sessionDir: string;
  metadataPath: string;
  eventsPath: string;
} {
  const safeId = normalizeSessionId(id);
  const baseDir = resolveBaseDir(options);
  const sessionDir = join(baseDir, safeId);

  return {
    baseDir,
    sessionDir,
    metadataPath: join(sessionDir, METADATA_FILE),
    eventsPath: join(sessionDir, EVENTS_FILE),
  };
}

function resolveBaseDir(options: SessionStoreOptions): string {
  return options.baseDir ?? defaultSessionStoreDir();
}

function getNow(options: SessionStoreOptions): () => Date {
  return options.now ?? (() => new Date());
}

function getCreateId(options: SessionStoreOptions): () => string {
  return options.createId ?? randomUUID;
}

function normalizeSessionId(id: string): string {
  if (!SAFE_SESSION_ID.test(id)) {
    throw new Error(`Invalid session id: ${id}`);
  }

  return id;
}

function normalizeSessionEventId(id: string): string {
  if (id.length === 0 || id.includes("\n") || id.includes("\r")) {
    throw new Error("Invalid session event id");
  }

  return id;
}

function normalizeTimestamp(value: TimestampInput): string {
  const timestamp = value instanceof Date ? value.toISOString() : value;
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new Error(`Invalid timestamp: ${timestamp}`);
  }

  return timestamp;
}

function latestTimestamp(left: string, right: string): string {
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function normalizeContextLimit(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid context limit: ${value}`);
  }

  return value;
}

async function writeMetadata(path: string, metadata: SessionMetadata): Promise<void> {
  await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");
}

async function readMetadata(path: string): Promise<SessionMetadata> {
  return metadataFromObject(parseJsonObject(await readFile(path, "utf-8"), path), path);
}

async function readEvents(path: string): Promise<SessionEvent[]> {
  const raw = await readRawEvents(path);
  if (raw.trim().length === 0) return [];

  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => eventFromObject(parseJsonObject(line, `${path}:${index + 1}`), `${path}:${index + 1}`));
}

async function readRawEvents(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return "";
    throw error;
  }
}

function parseJsonObject(raw: string, source: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) {
    throw new Error(`Expected JSON object in ${source}`);
  }

  return parsed;
}

function metadataFromObject(record: Record<string, unknown>, source: string): SessionMetadata {
  return {
    id: normalizeSessionId(readString(record, "id", source)),
    repoPath: readString(record, "repoPath", source),
    model: readNullableString(record, "model", source),
    contextLimit: normalizeContextLimit(readNumber(record, "contextLimit", source)),
    tunnelUrl: readNullableString(record, "tunnelUrl", source),
    startedAt: normalizeTimestamp(readString(record, "startedAt", source)),
    updatedAt: normalizeTimestamp(readString(record, "updatedAt", source)),
  };
}

function eventFromObject(record: Record<string, unknown>, source: string): SessionEvent {
  const event: SessionEvent = {
    id: readString(record, "id", source),
    type: readString(record, "type", source),
    createdAt: normalizeTimestamp(readString(record, "createdAt", source)),
  };
  const role = readOptionalString(record, "role", source);
  const name = readOptionalString(record, "name", source);
  const status = readOptionalString(record, "status", source);
  const content = readOptionalString(record, "content", source);

  if (role !== undefined) event.role = normalizeRole(role, source);
  if (name !== undefined) event.name = name;
  if (status !== undefined) event.status = status;
  if (content !== undefined) event.content = content;

  const data = record.data;
  if (data !== undefined) {
    if (!isRecord(data)) {
      throw new Error(`Expected data to be an object in ${source}`);
    }
    event.data = data;
  }

  return event;
}

function normalizeRole(role: string, source: string): SessionEventRole {
  if (role === "user" || role === "assistant" || role === "system" || role === "tool") {
    return role;
  }

  throw new Error(`Invalid role in ${source}: ${role}`);
}

function readString(record: Record<string, unknown>, key: string, source: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`Expected ${key} to be a string in ${source}`);
  }

  return value;
}

function readOptionalString(
  record: Record<string, unknown>,
  key: string,
  source: string,
): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`Expected ${key} to be a string in ${source}`);
  }

  return value;
}

function readNullableString(record: Record<string, unknown>, key: string, source: string): string | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`Expected ${key} to be a string or null in ${source}`);
  }

  return value;
}

function readNumber(record: Record<string, unknown>, key: string, source: string): number {
  const value = record[key];
  if (typeof value !== "number") {
    throw new Error(`Expected ${key} to be a number in ${source}`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatTranscript(events: SessionEvent[]): string {
  return events.map(formatTranscriptEvent).join("\n");
}

function formatTranscriptEvent(event: SessionEvent): string {
  const prefix = `[${event.createdAt}]`;

  if (event.type === "message") {
    return `${prefix} ${event.role ?? "message"}: ${event.content ?? ""}`;
  }

  if (event.type === "action") {
    const name = event.name ? ` ${event.name}` : "";
    const status = event.status ? ` ${event.status}` : "";
    const detail = event.content ?? (event.data ? JSON.stringify(event.data) : "");
    return detail
      ? `${prefix} action${name}${status}: ${detail}`
      : `${prefix} action${name}${status}`;
  }

  const label = [event.type, event.name, event.status].filter(Boolean).join(" ");
  const detail = event.content ?? (event.data ? JSON.stringify(event.data) : "");

  return detail ? `${prefix} ${label}: ${detail}` : `${prefix} ${label}`;
}
