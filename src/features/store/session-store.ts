import { initSessionDir } from "./session-store.init.ts";
import type {
  AppendSessionEventInput,
  CreateSessionInput,
  SessionEvent,
  SessionExport,
  SessionMetadata,
  SessionRecord,
  SessionStoreOptions,
  UpdateSessionInput,
} from "./session-store.types.ts";
import { defaultSessionStoreDir, resolveBaseDir, sessionPaths } from "./session-store.paths.ts";
import { readEvents, readMetadata, writeMetadata } from "./session-store.readers.ts";
import { buildSessionEvent, buildSessionMetadata } from "./session-store.build.ts";
import { collectSessionMetadata, sortSessionsByActivity } from "./session-store.list.ts";
import { mergeSessionMetadata } from "./session-store.update.ts";
import { exportSession } from "./session-store.export.ts";
import { getLatestSession } from "./session-store.latest.ts";
import { persistAppendedEvent } from "./session-store.append.helpers.ts";
import { readSessionDirEntries } from "./session-store.dir.helpers.ts";

export { exportSession, getLatestSession };

export type {
  AppendSessionEventInput,
  CreateSessionInput,
  SessionEvent,
  SessionEventRole,
  SessionExport,
  SessionMetadata,
  SessionRecord,
  SessionStoreOptions,
  TimestampInput,
  UpdateSessionInput,
} from "./session-store.types.ts";

export { defaultSessionStoreDir };

/** Create a new session directory with empty event log. */
export async function createSession(input: CreateSessionInput, options: SessionStoreOptions = {}): Promise<SessionRecord> {
  const metadata = buildSessionMetadata(input, options);
  await initSessionDir({ metadata, options });
  return { metadata, events: [] };
}

/** Load session metadata and events from disk. */
export async function loadSession(id: string, options: SessionStoreOptions = {}): Promise<SessionRecord> {
  const paths = sessionPaths(id, options);
  return { metadata: await readMetadata(paths.metadataPath), events: await readEvents(paths.eventsPath) };
}

/** List all sessions sorted by most recent activity. */
export async function listSessions(options: SessionStoreOptions = {}): Promise<SessionMetadata[]> {
  const baseDir = resolveBaseDir(options);
  const sessions = await collectSessionMetadata({ baseDir, entries: await readSessionDirEntries(baseDir) });
  return sortSessionsByActivity(sessions);
}

/** Append one event to a session's JSONL log and bump `updatedAt`. */
export async function appendSessionEvent(
  sessionId: string,
  input: AppendSessionEventInput,
  options: SessionStoreOptions = {},
): Promise<SessionEvent> {
  const paths = sessionPaths(sessionId, options);
  const metadata = await readMetadata(paths.metadataPath);
  const event = buildSessionEvent(input, options);
  await persistAppendedEvent({ paths, metadata, event });
  return event;
}

/** Patch session metadata on disk. */
export async function updateSession(
  sessionId: string,
  input: UpdateSessionInput,
  options: SessionStoreOptions = {},
): Promise<SessionMetadata> {
  const paths = sessionPaths(sessionId, options);
  const next = mergeSessionMetadata({ current: await readMetadata(paths.metadataPath), input, options });
  await writeMetadata(paths.metadataPath, next);
  return next;
}
