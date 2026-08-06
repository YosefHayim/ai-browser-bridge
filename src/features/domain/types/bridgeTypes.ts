import type { PermissionMode } from "../permissions.ts";

/**
 * A provider id from the registry (`providers/providers.ts`). Typed as a string
 * here because `domain` is a leaf module and must not import `providers` (which
 * would cycle); `providerIdFrom` is the validator / single source of truth.
 */
export type BridgeProvider = string;

/** Persisted bridge configuration for a target repo. */
export type BridgeConfig = {
  /** Absolute path to the repo the bridge drives ChatGPT against. */
  repoPath: string;
  provider?: BridgeProvider;
  mcpPort: number;
  tunnelUrl?: string;
  contextLimit: number;
  model?: string;
  permissionMode?: PermissionMode;
};
