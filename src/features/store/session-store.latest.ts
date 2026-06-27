import type { SessionMetadata, SessionRecord, SessionStoreOptions } from "./session-store.types.ts";
import { resolveBaseDir, sessionPaths } from "./session-store.paths.ts";
import { collectSessionMetadata, sortSessionsByActivity } from "./session-store.list.ts";
import { readEvents } from "./session-store.readers.ts";
import { readSessionDirEntries } from "./session-store.dir.helpers.ts";

/** Return the most recently updated session, or null when none exist. */
export async function getLatestSession(options: SessionStoreOptions = {}): Promise<SessionRecord | null> {
  const metadata = await findLatestSessionMetadata(options);
  if (!metadata) return null;
  const paths = sessionPaths(metadata.id, options);
  return { metadata, events: await readEvents(paths.eventsPath) };
}

/** Find the most recently updated session metadata row. */
async function findLatestSessionMetadata(options: SessionStoreOptions): Promise<SessionMetadata | null> {
  const baseDir = resolveBaseDir(options);
  const entries = await readSessionDirEntries(baseDir);
  const [latest] = sortSessionsByActivity(await collectSessionMetadata({ baseDir, entries }));
  return latest ?? null;
}

