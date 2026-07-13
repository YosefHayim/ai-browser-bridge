/**
 * Effect Schema definitions for the agentGateway feature.
 *
 * These schemas mirror the Zod `ASK_TOOL_PARAMS` shape used by the MCP SDK
 * boundary in `askGatewayServer.ts` and are intended for internal validation,
 * type derivation, and any future Effect-native tool handling.
 *
 * @module
 */
import { FanoutTaskSchema } from "@/features/bridge";
import { Schema } from "effect";

// ---------------------------------------------------------------------------
// ask tool arguments
// ---------------------------------------------------------------------------

/**
 * Schema for the `ask` tool parameters exposed over the outbound MCP gateway. Mirrors the
 * Zod `ASK_TOOL_PARAMS` shape: a `prompt` fanned across `providers`, or a parallel `tasks`
 * array, with concurrency, timeout, and pagination knobs.
 */
export const AskToolArgsSchema = Schema.Struct({
  prompt: Schema.optional(Schema.String.pipe(Schema.minLength(1))).annotations({
    description: "Prompt to fan out across `providers`; omit when using `tasks`.",
  }),
  providers: Schema.optional(Schema.String).annotations({
    description: "Comma-separated provider ids (e.g. 'chatgpt,gemini'); omit for the default.",
  }),
  tasks: Schema.optional(Schema.Array(FanoutTaskSchema)).annotations({
    description: "Independent Conversations to run in parallel; overrides `prompt`/`providers`.",
  }),
  timeoutSeconds: Schema.optional(Schema.Number.pipe(Schema.positive())).annotations({
    description: "Per-task reply timeout in seconds.",
  }),
  maxConcurrency: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())).annotations({
    description: "Max Conversations in flight at once (default 1 — serial).",
  }),
  limit: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())).annotations({
    description: "Max tasks to run and return per call (pagination window).",
  }),
  offset: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())).annotations({
    description: "Tasks to skip before running (pagination cursor).",
  }),
  maxReplyChars: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())).annotations({
    description: "Truncate each reply to this many characters for context safety.",
  }),
});

/**
 * Ask tool arguments type derived from the schema.
 */
export type AskToolArgs = Schema.Schema.Type<typeof AskToolArgsSchema>;

// ---------------------------------------------------------------------------
// ask tool result
// ---------------------------------------------------------------------------

/**
 * Schema for the result returned by {@link handleAskGatewayCall}.
 */
export const AskToolResultSchema = Schema.Struct({
  ok: Schema.Boolean,
  output: Schema.String,
});

/**
 * Ask tool result type derived from the schema.
 */
export type AskToolResult = Schema.Schema.Type<typeof AskToolResultSchema>;
