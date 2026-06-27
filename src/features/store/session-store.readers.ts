import { readFile, writeFile } from "node:fs/promises";
import { hasErrorCode } from "../domain/errors.ts";
import type { SessionEvent, SessionMetadata } from "./session-store.types.ts";
import { parseJsonObject } from "./session-store.normalizers.ts";
import { metadataFromObject, eventFromObject } from "./session-store.deserialize.ts";

/** Read and parse session metadata from disk. */
export async function readMetadata(path: string): Promise<SessionMetadata> {
  const raw = await readFile(path, "utf-8");
  return metadataFromObject(parseJsonObject(raw, path), path);
}

/** Read and parse all session events from a JSONL file. */
export async function readEvents(path: string): Promise<SessionEvent[]> {
  const raw = await readRawEvents(path);
  if (raw.trim().length === 0) return [];
  return parseEventLines({ raw, path });
}

/** Parse non-empty JSONL lines into session events. */
function parseEventLines(input: { raw: string; path: string }): SessionEvent[] {
  return input.raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => parseEventLine({ line, path: input.path }));
}

/** Parse one JSONL line into a session event. */
function parseEventLine(input: { line: string; path: string }): SessionEvent {
  const source = `${input.path}:${input.line.length}`;
  return eventFromObject(parseJsonObject(input.line, source), source);
}

/** Read raw events file contents, returning "" when missing. */
export async function readRawEvents(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return "";
    throw error;
  }
}

/** Write session metadata JSON to disk. */
export async function writeMetadata(path: string, metadata: SessionMetadata): Promise<void> {
  await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");
}
