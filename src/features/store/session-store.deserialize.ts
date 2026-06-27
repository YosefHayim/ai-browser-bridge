import type { SessionEvent, SessionMetadata } from "./session-store.types.ts";
import {
  normalizeContextLimit,
  normalizeSessionId,
  normalizeTimestamp,
  readNullableString,
  readNumber,
  readString,
} from "./session-store.normalizers.ts";
import { applyOptionalEventFields } from "./session-store.deserialize.helpers.ts";

/** Build {@link SessionMetadata} from a parsed JSON object. */
export function metadataFromObject(record: Record<string, unknown>, source: string): SessionMetadata {
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

/** Build {@link SessionEvent} from a parsed JSON object. */
export function eventFromObject(record: Record<string, unknown>, source: string): SessionEvent {
  const event: SessionEvent = {
    id: readString(record, "id", source),
    type: readString(record, "type", source),
    createdAt: normalizeTimestamp(readString(record, "createdAt", source)),
  };
  applyOptionalEventFields({ event, record, source });
  return event;
}
