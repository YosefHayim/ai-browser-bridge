import { join } from "node:path";
import type { Dirent } from "node:fs";
import { hasErrorCode } from "../domain/errors.ts";
import type { SessionMetadata } from "./session-store.types.ts";
import { METADATA_FILE, SAFE_SESSION_ID } from "./session-store.constants.ts";
import { readMetadata } from "./session-store.readers.ts";

/** Context for collecting session metadata from directory entries. */
export interface CollectSessionMetadataContext {
  /** Sessions root directory. */
  baseDir: string;
  /** Directory entries under the sessions root. */
  entries: Dirent[];
}

/** Read metadata for every valid session directory entry. */
export async function collectSessionMetadata(ctx: CollectSessionMetadataContext): Promise<SessionMetadata[]> {
  const sessions: SessionMetadata[] = [];
  for (const entry of ctx.entries) {
    const metadata = await tryReadSessionMetadata({ baseDir: ctx.baseDir, entry });
    if (metadata) sessions.push(metadata);
  }
  return sessions;
}

/** Sort sessions by most recent `updatedAt` first. */
export function sortSessionsByActivity(sessions: SessionMetadata[]): SessionMetadata[] {
  return sessions.sort((...args: [SessionMetadata, SessionMetadata]) =>
    compareSessionActivity({ left: args[0], right: args[1] }));
}

/** Compare two sessions by most recent activity. */
function compareSessionActivity(input: { left: SessionMetadata; right: SessionMetadata }): number {
  return input.right.updatedAt.localeCompare(input.left.updatedAt);
}

/** Read metadata for one directory entry, skipping invalid or missing sessions. */
async function tryReadSessionMetadata(input: { baseDir: string; entry: Dirent }): Promise<SessionMetadata | null> {
  if (!input.entry.isDirectory() || !SAFE_SESSION_ID.test(input.entry.name)) return null;
  try {
    return await readMetadata(join(input.baseDir, input.entry.name, METADATA_FILE));
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw error;
  }
}
