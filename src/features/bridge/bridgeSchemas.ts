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
// FanoutOptions
// ---------------------------------------------------------------------------

/**
 * Schema for the options accepted by {@link fanoutAsk}.
 */
export const FanoutOptionsSchema = Schema.Struct({
  timeoutMs: Schema.optional(Schema.Number.pipe(Schema.positive())).annotations({
    description: "Per-provider timeout in ms (default 300000).",
  }),
});

/**
 * FanoutOptions type derived from the schema.
 */
export type FanoutOptionsFromSchema = Schema.Schema.Type<typeof FanoutOptionsSchema>;

// ---------------------------------------------------------------------------
// ProviderAskOutcome
// ---------------------------------------------------------------------------

/**
 * Schema for the outcome of asking one provider within a fan-out.
 */
export const ProviderAskOutcomeSchema = Schema.Struct({
  ok: Schema.Boolean,
  reply: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  elapsedMs: Schema.Number,
});

/**
 * ProviderAskOutcome type derived from the schema.
 */
export type ProviderAskOutcomeFromSchema = Schema.Schema.Type<typeof ProviderAskOutcomeSchema>;
