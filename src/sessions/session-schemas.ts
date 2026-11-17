import { z } from "zod";

export const MESSAGE_EVENT_TYPE = "message";

// Session directory names must be path-safe single segments.
const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// An event id lives on one JSONL line, so it cannot hold a line break.
const SINGLE_LINE_TEXT = /^[^\r\n]+$/;

function isParsableTimestamp(timestamp: string): boolean {
  const parsedTime = Date.parse(timestamp);

  return !Number.isNaN(parsedTime);
}

export const SessionIdSchema = z.string().regex(SAFE_SESSION_ID);

export const SessionEventIdSchema = z.string().regex(SINGLE_LINE_TEXT);

export const TimestampSchema = z.string().refine(isParsableTimestamp);

export const ContextLimitSchema = z.int().positive();

const SessionEventRoleSchema = z.enum(["user", "assistant", "system", "tool"]);

export const SessionMetadataSchema = z.object({
  id: SessionIdSchema,
  repoPath: z.string(),
  model: z.string().nullable(),
  contextLimit: ContextLimitSchema,
  tunnelUrl: z.string().nullable(),
  startedAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const SessionEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  createdAt: TimestampSchema,
  role: SessionEventRoleSchema.optional(),
  name: z.string().optional(),
  status: z.string().optional(),
  content: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export type SessionMetadata = z.infer<typeof SessionMetadataSchema>;

export type SessionEvent = z.infer<typeof SessionEventSchema>;

export type SessionEventRole = z.infer<typeof SessionEventRoleSchema>;

export type StoredSession = {
  metadata: SessionMetadata;
  events: SessionEvent[];
};

export type SessionExport = StoredSession & {
  transcript: string;
  json: string;
  jsonl: string;
};
