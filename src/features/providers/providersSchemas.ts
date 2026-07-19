/**
 * Effect Schema definitions for the providers feature.
 *
 * Provider id / selectors / config-entry schemas live in `@/config` (SSOT) and are
 * re-exported here so feature consumers can import one door. Wait/connector/model
 * shapes stay provider-local.
 *
 * @module
 */
export {
  BridgeProviderIdSchema,
  ProviderConfigEntrySchema,
  ProviderSelectorsSchema,
  type BridgeProviderId as BridgeProviderIdFromSchema,
  type ProviderConfigEntry as ProviderConfigEntryFromSchema,
  type ProviderSelectors as ProviderSelectorsFromSchema,
} from "@/config";

import { Schema } from "effect";

// ---------------------------------------------------------------------------
// ResponseWaitOptions schema
// ---------------------------------------------------------------------------

/**
 * Schema for the options passed when waiting on an assistant response in the browser.
 */
export const ResponseWaitOptionsSchema = Schema.Struct({
  timeout: Schema.optional(Schema.Number),
  previousAssistantCount: Schema.optional(Schema.Number),
  previousLastAssistantText: Schema.optional(Schema.String),
  expectImages: Schema.optional(Schema.Number),
});

/**
 * ResponseWaitOptions type derived from the schema.
 */
export type ResponseWaitOptionsFromSchema = Schema.Schema.Type<typeof ResponseWaitOptionsSchema>;

// ---------------------------------------------------------------------------
// ConnectorSetupOptions schema
// ---------------------------------------------------------------------------

/**
 * Schema for options passed to the MCP connector setup UI.
 */
export const ConnectorSetupOptionsSchema = Schema.Struct({
  connectorName: Schema.optional(Schema.String),
  automatic: Schema.optional(Schema.Boolean),
});

/**
 * ConnectorSetupOptions type derived from the schema.
 */
export type ConnectorSetupOptionsFromSchema = Schema.Schema.Type<
  typeof ConnectorSetupOptionsSchema
>;

// ---------------------------------------------------------------------------
// ConnectorSetupResult schema
// ---------------------------------------------------------------------------

/**
 * Schema for the outcome of an MCP connector setup flow.
 */
export const ConnectorSetupResultSchema = Schema.Struct({
  connectorUrl: Schema.String,
  completed: Schema.Boolean,
  steps: Schema.Array(Schema.String),
  warnings: Schema.Array(Schema.String),
});

/**
 * ConnectorSetupResult type derived from the schema.
 */
export type ConnectorSetupResultFromSchema = Schema.Schema.Type<typeof ConnectorSetupResultSchema>;

// ---------------------------------------------------------------------------
// ModelOption schema
// ---------------------------------------------------------------------------

/**
 * Schema for a model picker option from the provider UI.
 */
export const ModelOptionSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  selected: Schema.Boolean,
});

/**
 * ModelOption type derived from the schema.
 */
export type ModelOptionFromSchema = Schema.Schema.Type<typeof ModelOptionSchema>;
