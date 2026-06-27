import { appendFile } from "node:fs/promises";
import type { SessionEvent, SessionMetadata } from "./session-store.types.ts";
import { latestTimestamp } from "./session-store.normalizers.ts";
import { writeMetadata } from "./session-store.readers.ts";
import type { sessionPaths } from "./session-store.paths.ts";

/** Append one event and bump session updatedAt. */
export async function persistAppendedEvent(input: {
  paths: ReturnType<typeof sessionPaths>;
  metadata: SessionMetadata;
  event: SessionEvent;
}): Promise<void> {
  await appendFile(input.paths.eventsPath, `${JSON.stringify(input.event)}\n`, "utf-8");
  await writeMetadata(input.paths.metadataPath, {
    ...input.metadata,
    updatedAt: latestTimestamp(input.metadata.updatedAt, input.event.createdAt),
  });
}
