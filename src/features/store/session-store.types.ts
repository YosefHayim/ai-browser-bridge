/** ISO timestamp or Date accepted by session store normalizers. */
export type TimestampInput = Date | string;

/** Options for session store I/O (base dir, clock, id factory). */
export interface SessionStoreOptions {
  baseDir?: string;
  now?: () => Date;
  createId?: () => string;
}

/** Persisted session metadata. */
export interface SessionMetadata {
  id: string;
  repoPath: string;
  model: string | null;
  contextLimit: number;
  tunnelUrl: string | null;
  startedAt: string;
  updatedAt: string;
}

/** Role of a transcript message event. */
export type SessionEventRole = "user" | "assistant" | "system" | "tool";

/** One persisted session event (message, action, etc.). */
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

/** Loaded session metadata plus its event log. */
export interface SessionRecord {
  metadata: SessionMetadata;
  events: SessionEvent[];
}

export type {
  AppendSessionEventInput,
  CreateSessionInput,
  SessionExport,
  UpdateSessionInput,
} from "./session-store.input.types.ts";
