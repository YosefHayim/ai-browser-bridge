import type { AppendSessionEventInput, CreateSessionInput, SessionEvent, SessionMetadata, SessionStoreOptions } from "./session-store.types.ts";
import {
  getCreateId,
  getNow,
  normalizeContextLimit,
  normalizeSessionEventId,
  normalizeSessionId,
  normalizeTimestamp,
} from "./session-store.normalizers.ts";

/** Build initial session metadata for {@link createSession}. */
export function buildSessionMetadata(input: CreateSessionInput, options: SessionStoreOptions): SessionMetadata {
  const id = normalizeSessionId(input.id ?? getCreateId(options)());
  const startedAt = normalizeTimestamp(input.startedAt ?? getNow(options)());
  const updatedAt = normalizeTimestamp(input.updatedAt ?? startedAt);
  return {
    id,
    repoPath: input.repoPath,
    model: input.model ?? null,
    contextLimit: normalizeContextLimit(input.contextLimit),
    tunnelUrl: input.tunnelUrl ?? null,
    startedAt,
    updatedAt,
  };
}

/** Build a session event record for {@link appendSessionEvent}. */
export function buildSessionEvent(input: AppendSessionEventInput, options: SessionStoreOptions): SessionEvent {
  return {
    id: normalizeSessionEventId(input.id ?? getCreateId(options)()),
    type: input.type,
    createdAt: normalizeTimestamp(input.createdAt ?? getNow(options)()),
    ...(input.role ? { role: input.role } : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.content !== undefined ? { content: input.content } : {}),
    ...(input.data !== undefined ? { data: input.data } : {}),
  };
}
