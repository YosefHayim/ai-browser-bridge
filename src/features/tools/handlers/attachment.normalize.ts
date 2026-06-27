import type { Attachment, ToolResult } from "../../domain/types.ts";

/** Path to the lazy-loaded downloader module. */
export const DOWNLOADER_MODULE = "../../providers/chatgpt/attachments/download-attachment.ts";

/** Normalized single attachment download result. */
export interface SingleDownloadResult {
  path: string;
  bytes: number;
}

/** Normalized bulk attachment download result. */
export interface DownloadResult {
  id?: string;
  path: string;
  bytes: number;
  error?: string;
}

/** Serialize a tool result payload as JSON output. */
export function jsonResult(value: unknown): ToolResult {
  return { ok: true, output: JSON.stringify(value) };
}

/** Whether a value is a non-null object record. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Return a non-empty string when the value is a string. */
export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Normalize a single download result from the downloader module. */
export function normalizeSingleDownloadResult(value: unknown): SingleDownloadResult {
  if (!isRecord(value)) return { path: String(value), bytes: 0 };
  return {
    path: typeof value.path === "string" ? value.path : "",
    bytes: typeof value.bytes === "number" ? value.bytes : 0,
  };
}

/** Normalize one bulk download result item. */
export function normalizeDownloadResult(value: unknown, fallbackId: string): DownloadResult {
  if (!isRecord(value)) return { id: fallbackId, path: String(value), bytes: 0 };
  return {
    id: typeof value.id === "string" ? value.id : fallbackId,
    path: typeof value.path === "string" ? value.path : "",
    bytes: typeof value.bytes === "number" ? value.bytes : 0,
    error: typeof value.error === "string" ? value.error : undefined,
  };
}

/** Normalize many download results from the downloader module. */
export function normalizeDownloadAll(value: unknown): DownloadResult[] {
  if (!Array.isArray(value)) return [];
  const results: DownloadResult[] = [];
  for (let index = 0; index < value.length; index += 1) {
    results.push(normalizeDownloadResult(value[index], `attachment-${index + 1}`));
  }
  return results;
}
