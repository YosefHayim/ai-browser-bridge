import { join } from "node:path";
import type { SessionStoreOptions } from "./session-store.types.ts";
import { METADATA_FILE, EVENTS_FILE } from "./session-store.constants.ts";
import { normalizeSessionId } from "./session-store.normalizers.ts";
import { sessionsDir } from "./paths.ts";

/** Resolved on-disk paths for one session directory. */
export interface SessionPaths {
  /** Sessions root directory. */
  baseDir: string;
  /** Per-session directory. */
  sessionDir: string;
  /** Path to `metadata.json`. */
  metadataPath: string;
  /** Path to `events.jsonl`. */
  eventsPath: string;
}

/** Default sessions directory for the current working directory. */
export function defaultSessionStoreDir(): string {
  return sessionsDir(process.cwd());
}

/** Resolve the sessions base directory from options. */
export function resolveBaseDir(options: SessionStoreOptions): string {
  return options.baseDir ?? defaultSessionStoreDir();
}

/** Resolve on-disk paths for a session id. */
export function sessionPaths(id: string, options: SessionStoreOptions): SessionPaths {
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
