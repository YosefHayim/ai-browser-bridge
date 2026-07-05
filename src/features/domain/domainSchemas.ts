/**
 * Effect Schema definitions for the domain feature.
 *
 * These schemas are the single source of truth for runtime validation of
 * domain types. Pure TypeScript interfaces in `types/` remain for structural
 * typing; these schemas add encode/decode + validation at boundaries.
 */

import { Schema } from "effect";

/**
 * Schema for the permission mode governing MCP tool access.
 */
export const PermissionModeSchema = Schema.Literal("read-only", "ask", "auto");

/**
 * Permission mode type derived from the schema.
 */
export type PermissionMode = Schema.Schema.Type<typeof PermissionModeSchema>;

/**
 * Schema for the result shape returned by MCP tool handlers.
 */
export const ToolResultSchema = Schema.Struct({
  ok: Schema.Boolean,
  output: Schema.String,
  error: Schema.optional(Schema.String),
});

/**
 * ToolResult type derived from the schema.
 */
export type ToolResult = Schema.Schema.Type<typeof ToolResultSchema>;

/**
 * Schema for the persisted bridge configuration.
 */
export const BridgeConfigSchema = Schema.Struct({
  repoPath: Schema.String,
  provider: Schema.optional(Schema.String),
  mcpPort: Schema.Number,
  tunnelUrl: Schema.optional(Schema.String),
  contextLimit: Schema.Number,
  model: Schema.optional(Schema.String),
  permissionMode: Schema.optional(PermissionModeSchema),
});

/**
 * BridgeConfig type derived from the schema.
 */
export type BridgeConfig = Schema.Schema.Type<typeof BridgeConfigSchema>;
