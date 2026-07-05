/**
 * Effect Schema definitions for the agentGateway feature.
 *
 * These schemas mirror the Zod `ASK_TOOL_PARAMS` shape used by the MCP SDK
 * boundary in `askGatewayServer.ts` and are intended for internal validation,
 * type derivation, and any future Effect-native tool handling.
 *
 * @module
 */
import { Schema } from "effect";

// ---------------------------------------------------------------------------
// ask tool arguments
// ---------------------------------------------------------------------------

/**
 * Schema for the `ask` tool parameters exposed over the outbound MCP gateway.
 */
export const AskToolArgsSchema = Schema.Struct({
  prompt: Schema.String.pipe(Schema.minLength(1)).annotations({
    description: "The prompt to send to each provider.",
  }),
  providers: Schema.optional(
    Schema.String.annotations({
      description: "Comma-separated provider ids (e.g. 'chatgpt,gemini'); omit for the default.",
    }),
  ),
  timeoutSeconds: Schema.optional(
    Schema.Number.pipe(Schema.positive()).annotations({
      description: "Per-provider timeout in seconds.",
    }),
  ),
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
