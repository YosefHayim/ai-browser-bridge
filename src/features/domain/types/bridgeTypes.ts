import type { PermissionMode } from "../permissions.ts";

/**
 * A provider id from the registry (`providers/providerRegistry.ts`). Typed as a string
 * here because `domain` is a leaf module and must not import `providers` (which would
 * cycle); `normalizeProvider` is the validator / single source of truth.
 */
export type BridgeProvider = string;

/** Persisted bridge configuration for a target repo. */
export interface BridgeConfig {
  /** Absolute path to the repo the bridge drives ChatGPT against. */
  repoPath: string;
  /** Browser provider to drive from the terminal. Defaults to ChatGPT. */
  provider?: BridgeProvider;
  /** @deprecated Replaced by the isolated bridge profile at `<repo>/.bridge/chrome-profile`. */
  browserProfilePath?: string;
  /** Local port for the MCP server. */
  mcpPort: number;
  /** Optional tunnel URL for remote MCP access. */
  tunnelUrl?: string;
  /** Token budget used for context window display. */
  contextLimit: number;
  /** Preferred model name or alias. */
  model?: string;
  /** Default permission mode for tool calls. */
  permissionMode?: PermissionMode;
}
