export { createCheckpoint, listCheckpoints, restoreCheckpoint } from "./checkpoints.ts";
export { extractFileMentions, resolveFileMentions } from "./fileResolver.ts";
export { appendBridgeLog, bridgeLogPath } from "./logging.ts";
export {
  BRIDGE_DIR_NAME,
  bridgeDir,
  chromeProfileDir,
  configPath,
  ensureBridgeDir,
  exportsDir,
  HOOKS_FILE,
  homeHooksPath,
  screenshotsDir,
  sessionsDir,
} from "./paths.ts";
export {
  appendSessionEvent,
  createSession,
  exportSession,
  getLatestSession,
  listSessions,
  loadSession,
  updateSession,
} from "./sessionStore.ts";
export type { SessionExport, SessionMetadata, SessionStoreOptions } from "./sessionStore.ts";

// ---------------------------------------------------------------------------
// Effect Schemas
// ---------------------------------------------------------------------------

export {
  BridgeLogEventSchema,
  BridgeLogLineSchema,
  CheckpointFileSnapshotSchema,
  CheckpointPhaseSchema,
  CheckpointSchema,
  CheckpointSummarySchema,
  ResolvedFileSchema,
  SessionEventRoleSchema,
  SessionEventSchema,
  SessionMetadataSchema,
  SessionRecordSchema,
} from "./storeSchemas.ts";

export type {
  BridgeLogEventFromSchema,
  BridgeLogLineFromSchema,
  CheckpointFileSnapshotFromSchema,
  CheckpointFromSchema,
  CheckpointPhaseFromSchema,
  CheckpointSummaryFromSchema,
  ResolvedFileFromSchema,
  SessionEventFromSchema,
  SessionEventRoleFromSchema,
  SessionMetadataFromSchema,
  SessionRecordFromSchema,
} from "./storeSchemas.ts";
