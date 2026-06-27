import { randomUUID } from "node:crypto";
import type { SessionEventRole, SessionStoreOptions, TimestampInput } from "./session-store.types.ts";
import { SAFE_SESSION_ID } from "./session-store.constants.ts";

/** Injectable clock from session store options. */
export function getNow(options: SessionStoreOptions): () => Date {
  return options.now ?? (() => new Date());
}

/** Injectable id factory from session store options. */
export function getCreateId(options: SessionStoreOptions): () => string {
  return options.createId ?? randomUUID;
}

/** Validate and return a session id safe for use as a directory name. */
export function normalizeSessionId(id: string): string {
  if (!SAFE_SESSION_ID.test(id)) throw new Error(`Invalid session id: ${id}`);
  return id;
}

/** Validate a session event id (no newlines). */
export function normalizeSessionEventId(id: string): string {
  if (id.length === 0 || id.includes("\n") || id.includes("\r")) {
    throw new Error("Invalid session event id");
  }
  return id;
}

/** Coerce a Date or ISO string to a validated ISO timestamp. */
export function normalizeTimestamp(value: TimestampInput): string {
  const timestamp = value instanceof Date ? value.toISOString() : value;
  if (Number.isNaN(Date.parse(timestamp))) throw new Error(`Invalid timestamp: ${timestamp}`);
  return timestamp;
}

/** Return the later of two ISO timestamps. */
export function latestTimestamp(left: string, right: string): string {
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

/** Validate a positive finite context limit. */
export function normalizeContextLimit(value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid context limit: ${value}`);
  return value;
}

/** Validate and return a session event role. */
export function normalizeRole(role: string, source: string): SessionEventRole {
  if (role === "user" || role === "assistant" || role === "system" || role === "tool") return role;
  throw new Error(`Invalid role in ${source}: ${role}`);
}

/** Type guard for plain JSON objects. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read a required string field from a JSON object. */
export function readString(record: Record<string, unknown>, key: string, source: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`Expected ${key} to be a string in ${source}`);
  return value;
}

/** Read an optional string field from a JSON object. */
export function readOptionalString(
  record: Record<string, unknown>,
  key: string,
  source: string,
): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`Expected ${key} to be a string in ${source}`);
  return value;
}

/** Read a nullable string field from a JSON object. */
export function readNullableString(record: Record<string, unknown>, key: string, source: string): string | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`Expected ${key} to be a string or null in ${source}`);
  return value;
}

/** Read a required number field from a JSON object. */
export function readNumber(record: Record<string, unknown>, key: string, source: string): number {
  const value = record[key];
  if (typeof value !== "number") throw new Error(`Expected ${key} to be a number in ${source}`);
  return value;
}

/** Parse JSON text and require a top-level object. */
export function parseJsonObject(raw: string, source: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new Error(`Expected JSON object in ${source}`);
  return parsed;
}
