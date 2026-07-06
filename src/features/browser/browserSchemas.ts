import { Schema } from "effect";

export const ChromeCacheEntrySchema = Schema.Struct({
  label: Schema.String,
  path: Schema.String,
  relativePath: Schema.String,
  exists: Schema.Boolean,
  bytes: Schema.Number,
  safeToPrune: Schema.Boolean,
});
export type ChromeCacheEntry = typeof ChromeCacheEntrySchema.Type;

export const CacheInventorySchema = Schema.Struct({
  profileRoot: Schema.String,
  entries: Schema.Array(ChromeCacheEntrySchema),
  reclaimableBytes: Schema.Number,
});
export type CacheInventory = typeof CacheInventorySchema.Type;

export const PruneCacheInputSchema = Schema.Struct({
  profileRoot: Schema.String,
  dryRun: Schema.optional(Schema.Boolean),
  confirm: Schema.optional(Schema.Boolean),
});
export type PruneCacheInput = typeof PruneCacheInputSchema.Type;

export const PruneCacheResultSchema = Schema.Struct({
  profileRoot: Schema.String,
  dryRun: Schema.Boolean,
  deletedBytes: Schema.Number,
  entries: Schema.Array(ChromeCacheEntrySchema),
});
export type PruneCacheResult = typeof PruneCacheResultSchema.Type;

export const BrowserStatusSchema = Schema.Struct({
  port: Schema.Number,
  debugPortListening: Schema.Boolean,
  chromeRunning: Schema.Boolean,
  userDataDir: Schema.NullOr(Schema.String),
  bridgeProfileRoot: Schema.String,
  canAttach: Schema.Boolean,
  state: Schema.Literal(
    "ready",
    "chrome-not-running",
    "chrome-running-without-debug",
    "debug-port-unverified",
  ),
  message: Schema.String,
});
export type BrowserStatus = typeof BrowserStatusSchema.Type;
