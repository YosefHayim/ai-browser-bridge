/**
 * Effect Schema definitions for the bridge feature.
 *
 * These schemas provide runtime validation and type derivation for the key
 * input/option types used by the bridge engine and fan-out orchestrator.
 * The existing implementations (`bridgeEngine.ts`, `orchestrator.ts`) remain
 * unchanged — these schemas are additive and exported through the door.
 *
 * @module
 */
import { Schema } from "effect";

import { PermissionModeSchema } from "@/features/domain";

// ---------------------------------------------------------------------------
// StartEngineOptions
// ---------------------------------------------------------------------------

/**
 * Schema for the options accepted by {@link BridgeEngine.start}.
 */
export const StartEngineOptionsSchema = Schema.Struct({
  repoPath: Schema.optional(Schema.String).annotations({
    description: "Target repository the MCP tools operate inside.",
  }),
  provider: Schema.optional(Schema.String).annotations({
    description: "Browser provider (e.g. 'chatgpt' or 'gemini').",
  }),
  mcpPort: Schema.optional(Schema.Number).annotations({
    description: "MCP server port. Defaults to the saved port or 8765.",
  }),
  withBrowser: Schema.optional(Schema.Boolean).annotations({
    description: "Launch/attach Chrome.",
  }),
  withTools: Schema.optional(Schema.Boolean).annotations({
    description: "Start the local MCP server. Defaults to true.",
  }),
  withTunnel: Schema.optional(Schema.Boolean).annotations({
    description: "Start the Cloudflare tunnel + sync the ChatGPT connector.",
  }),
  persist: Schema.optional(Schema.Boolean).annotations({
    description: "Persist repo-local config, sessions, logs, and checkpoints under `.bridge/`.",
  }),
});

/**
 * StartEngineOptions type derived from the schema.
 */
export type StartEngineOptionsFromSchema = Schema.Schema.Type<typeof StartEngineOptionsSchema>;

// ---------------------------------------------------------------------------
// AskEngineInput
// ---------------------------------------------------------------------------

/**
 * Schema for the input to {@link BridgeEngine.ask}.
 */
export const AskEngineInputSchema = Schema.Struct({
  content: Schema.String.pipe(Schema.minLength(1)).annotations({
    description: "User prompt text.",
  }),
  timeoutMs: Schema.optional(Schema.Number.pipe(Schema.positive())).annotations({
    description: "Optional timeout override in milliseconds.",
  }),
  expectImages: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())).annotations({
    description: "Number of generated images to wait for before returning (ChatGPT only).",
  }),
});

/**
 * AskEngineInput type derived from the schema.
 */
export type AskEngineInputFromSchema = Schema.Schema.Type<typeof AskEngineInputSchema>;

// ---------------------------------------------------------------------------
// ShutdownEngineInput
// ---------------------------------------------------------------------------

/**
 * Schema for the input to {@link BridgeEngine.shutdown}.
 */
export const ShutdownEngineInputSchema = Schema.Struct({
  closeBrowser: Schema.optional(Schema.Boolean).annotations({
    description: "Whether to close the browser on shutdown.",
  }),
});

/**
 * ShutdownEngineInput type derived from the schema.
 */
export type ShutdownEngineInputFromSchema = Schema.Schema.Type<typeof ShutdownEngineInputSchema>;

// ---------------------------------------------------------------------------
// EngineRuntimeState
// ---------------------------------------------------------------------------

/**
 * Schema for the mutable session and permission state shared by engine methods.
 */
export const EngineRuntimeStateSchema = Schema.Struct({
  sessionId: Schema.String.annotations({
    description: "Active session id for persistence.",
  }),
  permissionMode: PermissionModeSchema.annotations({
    description: "Current permission mode for MCP tool calls.",
  }),
});

/**
 * EngineRuntimeState type derived from the schema.
 */
export type EngineRuntimeStateFromSchema = Schema.Schema.Type<typeof EngineRuntimeStateSchema>;

// ---------------------------------------------------------------------------
// Fan-out tasks (parallel Conversations)
// ---------------------------------------------------------------------------

/**
 * Schema for one fan-out task: a single prompt aimed at one Conversation. Omitting
 * `conversation` starts a new Conversation; providing an id/URL resumes an existing one.
 * The older across-providers fan-out is this same shape with one task per provider.
 */
export const FanoutTaskSchema = Schema.Struct({
  prompt: Schema.String.pipe(Schema.minLength(1)).annotations({
    description: "Prompt to send in this Conversation.",
  }),
  provider: Schema.optional(Schema.String).annotations({
    description: "Provider id (e.g. 'chatgpt'); omit for the batch default provider.",
  }),
  conversation: Schema.optional(Schema.String).annotations({
    description: "Existing Conversation id or URL to resume; omit to start a new Conversation.",
  }),
  label: Schema.optional(Schema.String).annotations({
    description: "Caller label echoed back on this task's result row.",
  }),
  isolate: Schema.optional(Schema.String).annotations({
    description: "Isolated profile name; drives this task in a separate signed-in Chrome.",
  }),
});

/** One fan-out task, derived from {@link FanoutTaskSchema}. */
export type FanoutTask = typeof FanoutTaskSchema.Type;

/**
 * Schema for a batch of fan-out tasks — the ordered array the CLI `--batch` flag and the
 * MCP `ask` `tasks` argument both decode. At least one task is required.
 */
export const FanoutBatchSchema = Schema.Array(FanoutTaskSchema)
  .pipe(Schema.minItems(1))
  .annotations({ description: "Ordered array of fan-out tasks; one result row per task." });

/** A decoded fan-out batch, derived from {@link FanoutBatchSchema}. */
export type FanoutBatchInput = typeof FanoutBatchSchema.Type;

/**
 * Schema for the tunable options of a fan-out batch: concurrency, per-task timeout, reply
 * truncation, and output pagination. All optional; each has a conservative default.
 */
export const FanoutBatchOptionsSchema = Schema.Struct({
  maxConcurrency: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())).annotations({
    description: "Max Conversations in flight at once (default 1 — serial).",
  }),
  timeoutMs: Schema.optional(Schema.Number.pipe(Schema.positive())).annotations({
    description: "Per-task reply timeout in ms.",
  }),
  maxReplyChars: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())).annotations({
    description: "Truncate each reply to this many characters for context safety.",
  }),
  limit: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())).annotations({
    description: "Max tasks to run and return per call (pagination window).",
  }),
  offset: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())).annotations({
    description: "Skip this many tasks before running (pagination cursor).",
  }),
});

/** Fan-out batch options, derived from {@link FanoutBatchOptionsSchema}. */
export type FanoutBatchOptionsInput = typeof FanoutBatchOptionsSchema.Type;
