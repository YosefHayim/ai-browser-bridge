import type { TimestampInput, SessionEventRole, SessionRecord } from "./session-store.types.ts";

/** Input for {@link createSession}. */
export interface CreateSessionInput {
  id?: string;
  repoPath: string;
  model?: string | null;
  contextLimit: number;
  tunnelUrl?: string | null;
  startedAt?: TimestampInput;
  updatedAt?: TimestampInput;
}

/** Partial metadata patch for {@link updateSession}. */
export interface UpdateSessionInput {
  repoPath?: string;
  model?: string | null;
  contextLimit?: number;
  tunnelUrl?: string | null;
  updatedAt?: TimestampInput;
}

/** Input for {@link appendSessionEvent}. */
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

/** Export bundle with human-readable and machine-readable formats. */
export interface SessionExport extends SessionRecord {
  transcript: string;
  json: string;
  jsonl: string;
}

export type { TimestampInput, SessionEventRole } from "./session-store.types.ts";
