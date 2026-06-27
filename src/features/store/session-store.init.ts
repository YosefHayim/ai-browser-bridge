import { mkdir, writeFile } from "node:fs/promises";
import type { SessionMetadata, SessionStoreOptions } from "./session-store.types.ts";
import { sessionPaths } from "./session-store.paths.ts";
import { writeMetadata } from "./session-store.readers.ts";

/** Context for initializing a new session directory on disk. */
export interface InitSessionDirContext {
  metadata: SessionMetadata;
  options: SessionStoreOptions;
}

/** Create session directories and empty event log on disk. */
export async function initSessionDir(ctx: InitSessionDirContext): Promise<void> {
  const paths = sessionPaths(ctx.metadata.id, ctx.options);
  await mkdir(paths.baseDir, { recursive: true });
  await mkdir(paths.sessionDir);
  await writeMetadata(paths.metadataPath, ctx.metadata);
  await writeFile(paths.eventsPath, "", "utf-8");
}
