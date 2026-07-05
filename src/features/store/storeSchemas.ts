/**
 * Effect Schema definitions for the store feature.
 *
 * These schemas are the single source of truth for runtime validation of
 * session metadata, session events, checkpoints, and log entries at boundaries.
 * The existing implementation in `internal/sessionStore.ts` continues to work
 * as-is; these schemas enable gradual adoption of Effect-based validation.
 *
 * @module
 */
import { Schema } from "effect";

// ---------------------------------------------------------------------------
// Session schemas
// ---------------------------------------------------------------------------

/**
 * Schema for the role of a transcript message event.
 */
export const SessionEventRoleSchema = Schema.Literal("user", "assistant", "system", "tool");

/**
 * SessionEventRole type derived from the schema.
 */
export type SessionEventRoleFromSchema = Schema.Schema.Type<typeof SessionEventRoleSchema>;

/**
 * Schema for persisted session metadata.
 */
export const SessionMetadataSchema = Schema.Struct({
  id: Schema.String,
  repoPath: Schema.String,
  model: Schema.NullOr(Schema.String),
  contextLimit: Schema.Number,
  tunnelUrl: Schema.NullOr(Schema.String),
  startedAt: Schema.String,
  updatedAt: Schema.String,
});

/**
 * SessionMetadata type derived from the schema.
 */
export type SessionMetadataFromSchema = Schema.Schema.Type<typeof SessionMetadataSchema>;

/**
 * Schema for one persisted session event (message, action, etc.).
 */
export const SessionEventSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  createdAt: Schema.String,
  role: Schema.optional(SessionEventRoleSchema),
  name: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
  data: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});

/**
 * SessionEvent type derived from the schema.
 */
export type SessionEventFromSchema = Schema.Schema.Type<typeof SessionEventSchema>;

/**
 * Schema for a loaded session record (metadata + events).
 */
export const SessionRecordSchema = Schema.Struct({
  metadata: SessionMetadataSchema,
  events: Schema.Array(SessionEventSchema),
});

/**
 * SessionRecord type derived from the schema.
 */
export type SessionRecordFromSchema = Schema.Schema.Type<typeof SessionRecordSchema>;

// ---------------------------------------------------------------------------
// Checkpoint schemas
// ---------------------------------------------------------------------------

/**
 * Schema for checkpoint phase relative to a patch operation.
 */
export const CheckpointPhaseSchema = Schema.Literal("before", "after");

/**
 * CheckpointPhase type derived from the schema.
 */
export type CheckpointPhaseFromSchema = Schema.Schema.Type<typeof CheckpointPhaseSchema>;

/**
 * Schema for a snapshot of one file at checkpoint time.
 */
export const CheckpointFileSnapshotSchema = Schema.Struct({
  relativePath: Schema.String,
  exists: Schema.Boolean,
  size: Schema.Number,
  sha256: Schema.optional(Schema.String),
  snapshotRef: Schema.optional(Schema.String),
});

/**
 * CheckpointFileSnapshot type derived from the schema.
 */
export type CheckpointFileSnapshotFromSchema = Schema.Schema.Type<
  typeof CheckpointFileSnapshotSchema
>;

/**
 * Schema for a full checkpoint record persisted on disk.
 */
export const CheckpointSchema = Schema.Struct({
  id: Schema.String,
  repoRoot: Schema.String,
  createdAt: Schema.String,
  phase: CheckpointPhaseSchema,
  label: Schema.optional(Schema.String),
  files: Schema.Array(CheckpointFileSnapshotSchema),
});

/**
 * Checkpoint type derived from the schema.
 */
export type CheckpointFromSchema = Schema.Schema.Type<typeof CheckpointSchema>;

/**
 * Schema for a checkpoint summary row.
 */
export const CheckpointSummarySchema = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.String,
  phase: CheckpointPhaseSchema,
  fileCount: Schema.Number,
  label: Schema.optional(Schema.String),
});

/**
 * CheckpointSummary type derived from the schema.
 */
export type CheckpointSummaryFromSchema = Schema.Schema.Type<typeof CheckpointSummarySchema>;

// ---------------------------------------------------------------------------
// Logging schemas
// ---------------------------------------------------------------------------

/**
 * Schema for a bridge log event.
 */
export const BridgeLogEventSchema = Schema.Struct({
  repoPath: Schema.String,
  type: Schema.String,
  data: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});

/**
 * BridgeLogEvent type derived from the schema.
 */
export type BridgeLogEventFromSchema = Schema.Schema.Type<typeof BridgeLogEventSchema>;

/**
 * Schema for a persisted bridge log line (as written to JSONL).
 */
export const BridgeLogLineSchema = Schema.Struct({
  ts: Schema.String,
  repoPath: Schema.String,
  type: Schema.String,
  data: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

/**
 * BridgeLogLine type derived from the schema.
 */
export type BridgeLogLineFromSchema = Schema.Schema.Type<typeof BridgeLogLineSchema>;

// ---------------------------------------------------------------------------
// File resolver schemas
// ---------------------------------------------------------------------------

/**
 * Schema for a resolved @file mention result.
 */
export const ResolvedFileSchema = Schema.Struct({
  relPath: Schema.String,
  content: Schema.String,
});

/**
 * ResolvedFile type derived from the schema.
 */
export type ResolvedFileFromSchema = Schema.Schema.Type<typeof ResolvedFileSchema>;
