import type { SessionMetadata, SessionStoreOptions, UpdateSessionInput } from "./session-store.types.ts";
import { getNow, normalizeContextLimit, normalizeTimestamp } from "./session-store.normalizers.ts";

/** Context for merging session metadata updates. */
export interface MergeSessionMetadataContext {
  current: SessionMetadata;
  input: UpdateSessionInput;
  options: SessionStoreOptions;
}

/** Merge an update patch into existing session metadata. */
export function mergeSessionMetadata(ctx: MergeSessionMetadataContext): SessionMetadata {
  return {
    ...ctx.current,
    ...(ctx.input.repoPath !== undefined ? { repoPath: ctx.input.repoPath } : {}),
    ...(ctx.input.model !== undefined ? { model: ctx.input.model } : {}),
    ...(ctx.input.contextLimit !== undefined ? { contextLimit: normalizeContextLimit(ctx.input.contextLimit) } : {}),
    ...(ctx.input.tunnelUrl !== undefined ? { tunnelUrl: ctx.input.tunnelUrl } : {}),
    updatedAt: normalizeTimestamp(ctx.input.updatedAt ?? getNow(ctx.options)()),
  };
}
