export { hasErrorCode, isNodeError } from "./errors.ts";
export {
  findModelProfile,
  listModelProfiles,
} from "./models/modelLookup.ts";
export { MODEL_PROFILES, UNKNOWN_MODEL_PROFILE } from "./models/modelProfiles.ts";
export type { ModelProfile, ModelProvider } from "./models/modelProfileTypes.ts";
export {
  evaluateToolPermission,
  isPermissionMode,
  normalizePermissionMode,
  PERMISSION_MODES,
  type PermissionDecisionStatus,
  type PermissionMode,
  PermissionModeSchema,
  permissionDecisionToToolResult,
  type ToolPermissionDecision,
  type ToolPermissionKind,
  toolPermissionKind,
} from "./permissions.ts";
export type {
  Attachment,
  AttachmentManifest,
  AttachmentRole,
  BridgeConfig,
  BridgeProvider,
  CommandContext,
  CommandDef,
  ConnectorSetupOptions,
  ConnectorSetupResult,
  Conversation,
  Message,
  ModelOption,
  ToolCall,
  ToolDef,
  ToolResult,
} from "./types.ts";
