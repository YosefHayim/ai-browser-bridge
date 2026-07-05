/**
 * Effect Schema definitions for the providers feature.
 *
 * These schemas are the single source of truth for runtime validation of
 * provider-related input types at boundaries. The existing implementation
 * classes (`ChatGptPage`, `GenericWebChatPage`, `BrowserManager`, etc.) remain
 * untouched; these schemas enable gradual adoption of Effect-based validation.
 *
 * @module
 */
import { Schema } from "effect";

// ---------------------------------------------------------------------------
// Provider id schemas
// ---------------------------------------------------------------------------

/**
 * Schema for a supported provider id literal.
 */
export const BridgeProviderIdSchema = Schema.Literal(
  "chatgpt",
  "gemini",
  "claude",
  "deepseek",
  "grok",
  "perplexity",
);

/**
 * BridgeProviderId type derived from the schema.
 */
export type BridgeProviderIdFromSchema = Schema.Schema.Type<typeof BridgeProviderIdSchema>;

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

// ---------------------------------------------------------------------------
// ProviderSelectors schema
// ---------------------------------------------------------------------------

/**
 * Schema for DOM selectors describing a web-chat provider's core surface.
 */
export const ProviderSelectorsSchema = Schema.Struct({
  composer: Schema.String,
  assistant: Schema.String,
  user: Schema.optional(Schema.String),
  stop: Schema.optional(Schema.String),
  send: Schema.optional(Schema.String),
  newChat: Schema.optional(Schema.String),
  sidebarItem: Schema.optional(Schema.String),
  modelTrigger: Schema.optional(Schema.String),
  modelOption: Schema.optional(Schema.String),
  attach: Schema.optional(Schema.String),
  signedOut: Schema.optional(Schema.String),
});

/**
 * ProviderSelectors type derived from the schema.
 */
export type ProviderSelectorsFromSchema = Schema.Schema.Type<typeof ProviderSelectorsSchema>;

// ---------------------------------------------------------------------------
// ProviderConfigEntry schema
// ---------------------------------------------------------------------------

/**
 * Schema for the static metadata + core selectors for a supported browser provider.
 */
export const ProviderConfigEntrySchema = Schema.Struct({
  displayName: Schema.String,
  supportsMcpConnector: Schema.Boolean,
  origin: Schema.String,
  defaultUrl: Schema.String,
  defaultModel: Schema.String,
  selectors: ProviderSelectorsSchema,
});

/**
 * ProviderConfigEntry type derived from the schema.
 */
export type ProviderConfigEntryFromSchema = Schema.Schema.Type<typeof ProviderConfigEntrySchema>;
