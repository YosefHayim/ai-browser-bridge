import type { SessionExport, SessionRecord, SessionStoreOptions } from "./session-store.types.ts";
import { sessionPaths } from "./session-store.paths.ts";
import { readEvents, readMetadata, readRawEvents } from "./session-store.readers.ts";
import { formatTranscript } from "./session-store.transcript.ts";

/** Export a session with transcript, JSON, and JSONL formats. */
export async function exportSession(sessionId: string, options: SessionStoreOptions = {}): Promise<SessionExport> {
  const record = await loadSessionRecord({ sessionId, options });
  const jsonl = await readRawEvents(sessionPaths(sessionId, options).eventsPath);
  return { ...record, transcript: formatTranscript(record.events), json: `${JSON.stringify(record, null, 2)}\n`, jsonl };
}

/** Load session metadata and events without importing session-store.ts. */
async function loadSessionRecord(input: { sessionId: string; options: SessionStoreOptions }): Promise<SessionRecord> {
  const paths = sessionPaths(input.sessionId, input.options);
  return { metadata: await readMetadata(paths.metadataPath), events: await readEvents(paths.eventsPath) };
}
