import type { PermissionMode } from "./permissions.ts";

type BridgeProvider = string;

export type BridgeSettings = {
  repoPath: string;
  provider?: BridgeProvider;
  mcpPort: number;
  tunnelUrl?: string;
  contextLimit: number;
  model?: string;
  permissionMode?: PermissionMode;
};
