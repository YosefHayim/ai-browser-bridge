/** Supported hook lifecycle event names. */
export const HOOK_LIFECYCLE_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SessionEnd",
] as const;

/** Hook lifecycle event name. */
export type HookLifecycleEvent = (typeof HOOK_LIFECYCLE_EVENTS)[number];

/** Shell command invoked by a hook entry. */
export type HookCommand = string | readonly string[];

/** Validated hook definition from hooks.json. */
export interface HookDefinition {
  /** Source file path or inline label. */
  source: string;
  /** Lifecycle event that triggers the hook. */
  event: HookLifecycleEvent;
  /** Command to run when execution is enabled. */
  command: HookCommand;
  /** Optional display name. */
  name?: string;
  /** Whether the hook is active. */
  enabled: boolean;
}

/** Result of parsing a hooks.json payload. */
export interface ParseHooksResult {
  /** Valid hook definitions discovered in the payload. */
  hooks: HookDefinition[];
  /** Validation errors collected during parsing. */
  errors: string[];
}

/** Options for loading hook configs from disk. */
export interface LoadHooksOptions {
  /** Repo root whose `.bridge/hooks.json` is loaded first. */
  repoRoot: string;
  /** Optional home directory override for tests. */
  homeDir?: string;
}

/** Loaded hook configs from all search paths. */
export interface LoadedHooksConfig extends ParseHooksResult {
  /** Hook config paths that were searched. */
  paths: string[];
}

/** Status for a hook run attempt. */
export type HookRunStatus = "skipped" | "disabled";

/** Result of attempting to run one hook. */
export interface HookRunResult {
  /** Lifecycle event that was evaluated. */
  event: HookLifecycleEvent;
  /** Hook command that would have run. */
  command: HookCommand;
  /** Whether the hook was skipped or disabled. */
  status: HookRunStatus;
  /** Reason command execution did not occur. */
  reason: "hook-command-execution-disabled" | "hook-disabled";
}

/** Raw hook fields extracted from JSON. */
export interface RawHookFields {
  /** Lifecycle event name. */
  event?: unknown;
  /** Command string or argv array. */
  command?: unknown;
  /** Optional hook display name. */
  name?: unknown;
  /** Optional enabled flag. */
  enabled?: unknown;
}
