import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ZodType } from "zod";
import { hasErrorCode } from "@/errors.ts";
import { readFileIfPresent } from "@/read-file-if-present.ts";
import { readDefaultSessionStoreDirectory } from "@/repo-files/paths.ts";
import {
  ContextLimitSchema,
  type SessionEvent,
  SessionEventIdSchema,
  type SessionEventRole,
  SessionEventSchema,
  type SessionExport,
  SessionIdSchema,
  type SessionMetadata,
  SessionMetadataSchema,
  type StoredSession,
  TimestampSchema,
} from "@/sessions/session-schemas.ts";
import { writeTranscript } from "@/sessions/session-transcript.ts";

const METADATA_FILE = "metadata.json";
const EVENTS_FILE = "events.jsonl";
const JSON_INDENT_SPACES = 2;

type TimestampDetails = Date | string;

export type SessionStoreSettings = {
  now?: () => Date;
  createId?: () => string;
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
  content?: string | null;
  data?: Record<string, unknown>;
};

type SessionPaths = {
  sessionDirectory: string;
  metadataPath: string;
  eventsPath: string;
};

function parseJsonFile<Parsed>(schema: ZodType<Parsed>, json: string, origin: string): Parsed {
  const parsedJson: unknown = JSON.parse(json);
  const parsedFile = schema.safeParse(parsedJson);

  const isFileInvalid = !parsedFile.success;
  if (isFileInvalid) throw new Error(`Invalid session file ${origin}: ${parsedFile.error.message}`);

  return parsedFile.data;
}

function cleanSessionId(id: string): string {
  const parsedId = SessionIdSchema.safeParse(id);

  const isIdUnsafe = !parsedId.success;
  if (isIdUnsafe) throw new Error(`Invalid session id: ${id}`);

  return parsedId.data;
}

function cleanSessionEventId(id: string): string {
  const parsedId = SessionEventIdSchema.safeParse(id);

  const isIdInvalid = !parsedId.success;
  if (isIdInvalid) throw new Error("Invalid session event id");

  return parsedId.data;
}

function cleanTimestamp(field: TimestampDetails): string {
  const isInstanceDate = field instanceof Date;
  const timestamp = isInstanceDate ? field.toISOString() : field;
  const parsedTimestamp = TimestampSchema.safeParse(timestamp);

  const isTimestampInvalid = !parsedTimestamp.success;
  if (isTimestampInvalid) throw new Error(`Invalid timestamp: ${timestamp}`);

  return parsedTimestamp.data;
}

function cleanContextLimit(field: number): number {
  const parsedLimit = ContextLimitSchema.safeParse(field);

  const isLimitInvalid = !parsedLimit.success;
  if (isLimitInvalid) throw new Error(`Invalid context limit: ${field}`);

  return parsedLimit.data;
}

function readLatestTimestamp(left: string, right: string): string {
  const isLeftNewer = Date.parse(left) >= Date.parse(right);
  if (isLeftNewer) return left;

  return right;
}

function pickFieldOrCurrent(
  field: string | null | undefined,
  currentField: string | null,
): string | null {
  // undefined means the patch did not send the field; null means clear it.
  const isFieldMissing = field === undefined;
  if (isFieldMissing) return currentField;

  return field;
}

function isSafeSessionFolder(line: Dirent): boolean {
  const isSafeName = SessionIdSchema.safeParse(line.name).success;

  return line.isDirectory() && isSafeName;
}

function sortSessionsByActivity(sessions: SessionMetadata[]): SessionMetadata[] {
  return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function parseEventLine(line: string, path: string): SessionEvent {
  const origin = `${path}:${line.length}`;

  return parseJsonFile(SessionEventSchema, line, origin);
}

function isFilledEntry(entry: [string, unknown]): boolean {
  const [, field] = entry;

  return field != null;
}

function isLineFilled(line: string): boolean {
  return line.trim().length > 0;
}

export class SessionStore {
  constructor(
    private readonly directory: string = readDefaultSessionStoreDirectory(),
    private readonly settings: SessionStoreSettings = {},
  ) {}

  create = async (details: CreateSessionDetails): Promise<StoredSession> => {
    const metadata = this.buildMetadata(details);
    const paths = this.readPaths(metadata.id);
    await mkdir(this.directory, { recursive: true });
    await mkdir(paths.sessionDirectory);
    await this.writeMetadata(paths.metadataPath, metadata);
    await writeFile(paths.eventsPath, "", "utf-8");

    return { metadata, events: [] };
  };

  load = async (id: string): Promise<StoredSession> => {
    const paths = this.readPaths(id);
    const metadata = await this.readMetadata(paths.metadataPath);
    const events = await this.readEvents(paths.eventsPath);

    return { metadata, events };
  };

  list = async (): Promise<SessionMetadata[]> => {
    const lines = await this.readDirectoryListing();
    const sessions = await this.collectMetadata(lines);

    return sortSessionsByActivity(sessions);
  };

  readLatest = async (): Promise<StoredSession | null> => {
    const sessions = await this.list();
    const [latest] = sessions;

    const isLatestMissing = latest == null;
    if (isLatestMissing) return null;

    const paths = this.readPaths(latest.id);
    const events = await this.readEvents(paths.eventsPath);

    return { metadata: latest, events };
  };

  appendEvent = async (
    sessionId: string,
    details: AppendSessionEventDetails,
  ): Promise<SessionEvent> => {
    const paths = this.readPaths(sessionId);
    const metadata = await this.readMetadata(paths.metadataPath);
    const event = this.buildEvent(details);
    await appendFile(paths.eventsPath, `${JSON.stringify(event)}\n`, "utf-8");
    const updatedAt = readLatestTimestamp(metadata.updatedAt, event.createdAt);
    await this.writeMetadata(paths.metadataPath, { ...metadata, updatedAt });

    return event;
  };

  update = async (sessionId: string, details: UpdateSessionDetails): Promise<SessionMetadata> => {
    const paths = this.readPaths(sessionId);
    const storedMetadata = await this.readMetadata(paths.metadataPath);
    const merged = this.mergeMetadata(storedMetadata, details);
    await this.writeMetadata(paths.metadataPath, merged);

    return merged;
  };

  exportFormats = async (sessionId: string): Promise<SessionExport> => {
    const session = await this.load(sessionId);
    const paths = this.readPaths(sessionId);
    const jsonl = await readFileIfPresent(paths.eventsPath);

    return {
      ...session,
      transcript: writeTranscript(session.events),
      json: `${JSON.stringify(session, null, JSON_INDENT_SPACES)}\n`,
      jsonl: jsonl ?? "",
    };
  };

  private readPaths = (id: string): SessionPaths => {
    const sessionDirectory = join(this.directory, cleanSessionId(id));

    return {
      sessionDirectory,
      metadataPath: join(sessionDirectory, METADATA_FILE),
      eventsPath: join(sessionDirectory, EVENTS_FILE),
    };
  };

  private readNow = (): Date => {
    const clock = this.settings.now ?? (() => new Date());

    return clock();
  };

  private readNextId = (): string => {
    const createId = this.settings.createId ?? randomUUID;

    return createId();
  };

  private pickTimestampOrClock = (timestamp: TimestampDetails | undefined): string => {
    const isTimestampMissing = timestamp == null;
    if (isTimestampMissing) return cleanTimestamp(this.readNow());

    return cleanTimestamp(timestamp);
  };

  private buildMetadata = (details: CreateSessionDetails): SessionMetadata => {
    const idField = details.id ?? this.readNextId();
    const startedAt = this.pickTimestampOrClock(details.startedAt);
    const updatedField = details.updatedAt ?? startedAt;

    return {
      id: cleanSessionId(idField),
      repoPath: details.repoPath,
      model: details.model ?? null,
      contextLimit: cleanContextLimit(details.contextLimit),
      tunnelUrl: details.tunnelUrl ?? null,
      startedAt,
      updatedAt: cleanTimestamp(updatedField),
    };
  };

  private buildEvent = (details: AppendSessionEventDetails): SessionEvent => {
    const idField = details.id ?? this.readNextId();
    const optionalFields = {
      role: details.role,
      name: details.name,
      status: details.status,
      content: details.content,
      data: details.data,
    };
    const filledFields = Object.fromEntries(Object.entries(optionalFields).filter(isFilledEntry));

    return {
      id: cleanSessionEventId(idField),
      type: details.type,
      createdAt: this.pickTimestampOrClock(details.createdAt),
      ...filledFields,
    };
  };

  private mergeMetadata = (
    current: SessionMetadata,
    details: UpdateSessionDetails,
  ): SessionMetadata => {
    const contextLimit = details.contextLimit ?? current.contextLimit;

    return {
      id: current.id,
      repoPath: details.repoPath ?? current.repoPath,
      model: pickFieldOrCurrent(details.model, current.model),
      contextLimit: cleanContextLimit(contextLimit),
      tunnelUrl: pickFieldOrCurrent(details.tunnelUrl, current.tunnelUrl),
      startedAt: current.startedAt,
      updatedAt: this.pickTimestampOrClock(details.updatedAt),
    };
  };

  private writeMetadata = async (path: string, metadata: SessionMetadata): Promise<void> => {
    const json = JSON.stringify(metadata, null, JSON_INDENT_SPACES);
    await writeFile(path, `${json}\n`, "utf-8");
  };

  private readMetadata = async (path: string): Promise<SessionMetadata> => {
    const json = await readFile(path, "utf-8");

    return parseJsonFile(SessionMetadataSchema, json, path);
  };

  private readEvents = async (path: string): Promise<SessionEvent[]> => {
    const unparsed = await readFileIfPresent(path);
    const lines = (unparsed ?? "").split(/\r?\n/).filter(isLineFilled);

    return lines.map((line) => parseEventLine(line, path));
  };

  private readDirectoryListing = async (): Promise<Dirent[]> => {
    try {
      return await readdir(this.directory, { withFileTypes: true });
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return [];

      throw error;
    }
  };

  private tryReadMetadata = async (line: Dirent): Promise<SessionMetadata | null> => {
    const isUnsafeFolder = !isSafeSessionFolder(line);
    if (isUnsafeFolder) return null;

    try {
      return await this.readMetadata(join(this.directory, line.name, METADATA_FILE));
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return null;

      throw error;
    }
  };

  private collectMetadata = async (lines: Dirent[]): Promise<SessionMetadata[]> => {
    const sessions: SessionMetadata[] = [];
    for (const line of lines) {
      const metadata = await this.tryReadMetadata(line);

      const hasMetadata = metadata != null;
      if (hasMetadata) sessions.push(metadata);
    }

    return sessions;
  };
}
