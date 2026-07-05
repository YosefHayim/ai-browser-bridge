/**
 * Effect Schema definitions for the user-config feature.
 *
 * These schemas are the single source of truth for runtime validation of
 * hook definitions, custom commands, and project instructions at boundaries.
 * The existing implementation in `internal/userConfig.ts` continues to work
 * as-is; these schemas enable gradual adoption of Effect-based validation.
 */

import { Schema } from "effect";

// ---------------------------------------------------------------------------
// Hook schemas
// ---------------------------------------------------------------------------

/**
 * Schema for supported hook lifecycle event names.
 */
export const HookLifecycleEventSchema = Schema.Literal(
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SessionEnd",
);

/**
 * Hook lifecycle event type derived from the schema.
 */
export type HookLifecycleEventFromSchema = Schema.Schema.Type<typeof HookLifecycleEventSchema>;

/**
 * Schema for a hook command — either a single string or an array of strings.
 */
export const HookCommandSchema = Schema.Union(Schema.String, Schema.Array(Schema.String));

/**
 * Hook command type derived from the schema.
 */
export type HookCommandFromSchema = Schema.Schema.Type<typeof HookCommandSchema>;

/**
 * Schema for a validated hook definition from hooks.json.
 */
export const HookDefinitionSchema = Schema.Struct({
  source: Schema.String,
  event: HookLifecycleEventSchema,
  command: HookCommandSchema,
  name: Schema.optional(Schema.String),
  enabled: Schema.Boolean,
});

/**
 * HookDefinition type derived from the schema.
 */
export type HookDefinitionFromSchema = Schema.Schema.Type<typeof HookDefinitionSchema>;

/**
 * Schema for the result of parsing a hooks.json payload.
 */
export const ParseHooksResultSchema = Schema.Struct({
  hooks: Schema.Array(HookDefinitionSchema),
  errors: Schema.Array(Schema.String),
});

/**
 * ParseHooksResult type derived from the schema.
 */
export type ParseHooksResultFromSchema = Schema.Schema.Type<typeof ParseHooksResultSchema>;

/**
 * Schema for hook run status.
 */
export const HookRunStatusSchema = Schema.Literal("skipped", "disabled");

/**
 * Hook run status type derived from the schema.
 */
export type HookRunStatusFromSchema = Schema.Schema.Type<typeof HookRunStatusSchema>;

/**
 * Schema for a hook run result.
 */
export const HookRunResultSchema = Schema.Struct({
  event: HookLifecycleEventSchema,
  command: HookCommandSchema,
  status: HookRunStatusSchema,
  reason: Schema.Literal("hook-command-execution-disabled", "hook-disabled"),
});

/**
 * HookRunResult type derived from the schema.
 */
export type HookRunResultFromSchema = Schema.Schema.Type<typeof HookRunResultSchema>;

// ---------------------------------------------------------------------------
// Custom command schemas
// ---------------------------------------------------------------------------

/**
 * Schema for custom command source directory type.
 */
export const CustomCommandSourceSchema = Schema.Literal("project", "user");

/**
 * Custom command source type derived from the schema.
 */
export type CustomCommandSourceFromSchema = Schema.Schema.Type<typeof CustomCommandSourceSchema>;

/**
 * Schema for optional YAML frontmatter metadata in a custom command file.
 */
export const CustomCommandMetadataSchema = Schema.Struct({
  description: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  allowedTools: Schema.optional(Schema.Array(Schema.String)),
});

/**
 * CustomCommandMetadata type derived from the schema.
 */
export type CustomCommandMetadataFromSchema = Schema.Schema.Type<
  typeof CustomCommandMetadataSchema
>;

/**
 * Schema for a loaded custom command ready for rendering.
 */
export const CustomCommandSchema = Schema.Struct({
  name: Schema.String,
  filePath: Schema.String,
  source: CustomCommandSourceSchema,
  description: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  allowedTools: Schema.Array(Schema.String),
  promptTemplate: Schema.String,
});

/**
 * CustomCommand type derived from the schema.
 */
export type CustomCommandFromSchema = Schema.Schema.Type<typeof CustomCommandSchema>;

/**
 * Schema for a parsed command file (frontmatter + body).
 */
export const ParsedCommandFileSchema = Schema.Struct({
  metadata: CustomCommandMetadataSchema,
  body: Schema.String,
});

/**
 * ParsedCommandFile type derived from the schema.
 */
export type ParsedCommandFileFromSchema = Schema.Schema.Type<typeof ParsedCommandFileSchema>;

// ---------------------------------------------------------------------------
// Project instruction schemas
// ---------------------------------------------------------------------------

/**
 * Schema for recognized project instruction file names.
 */
export const ProjectInstructionFileNameSchema = Schema.Literal("AGENTS.md", "CLAUDE.md");

/**
 * Schema for a project instruction file entry.
 */
export const ProjectInstructionFileSchema = Schema.Struct({
  fileName: ProjectInstructionFileNameSchema,
  content: Schema.String,
});

/**
 * ProjectInstructionFile type derived from the schema.
 */
export type ProjectInstructionFileFromSchema = Schema.Schema.Type<
  typeof ProjectInstructionFileSchema
>;

/**
 * Schema for loaded project instructions.
 */
export const ProjectInstructionsSchema = Schema.Struct({
  files: Schema.Array(ProjectInstructionFileSchema),
  promptText: Schema.String,
});

/**
 * ProjectInstructions type derived from the schema.
 */
export type ProjectInstructionsFromSchema = Schema.Schema.Type<typeof ProjectInstructionsSchema>;
