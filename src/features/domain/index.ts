export { hasErrorCode, isNodeError, NodeError } from "./errors.ts";
export { UNKNOWN_MODEL_PROFILE, findModelProfile, listModelProfiles } from "./modelsConfig.ts";
export type { ModelProfile } from "./modelsConfig.ts";
export {
  PERMISSION_MODES,
  evaluateToolPermission,
  normalizePermissionMode,
  permissionDecisionToToolResult,
} from "./permissions.ts";
export type { PermissionMode } from "./permissions.ts";
export { BridgeConfigSchema, PermissionModeSchema, ToolResultSchema } from "./domainSchemas.ts";
export type {
  Attachment,
  AttachmentManifest,
  AttachmentRole,
  BridgeConfig,
  CommandContext,
  CommandDef,
  ConnectorSetupOptions,
  ConnectorSetupResult,
  Conversation,
  Message,
  ModelOption,
  ToolDef,
  ToolResult,
} from "./types.ts";
