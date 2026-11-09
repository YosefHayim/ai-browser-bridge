import { z } from "zod";

import { PermissionModeSchema } from "@/domain/permissions.ts";

const AskEngineInputSchema = z.object({
  content: z.string().min(1).describe("User prompt text."),
  timeoutMs: z
    .number()
    .positive()
    .optional()
    .describe("Optional timeout override in milliseconds."),
  expectImages: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Number of generated images to wait for before returning (ChatGPT only)."),
});

const ShutdownEngineInputSchema = z.object({
  closeBrowser: z.boolean().optional().describe("Whether to close the browser on shutdown."),
});

type ShutdownEngineInputFromSchema = z.infer<typeof ShutdownEngineInputSchema>;

const EngineRuntimeStateSchema = z.object({
  sessionId: z.string().describe("Active session id for persistence."),
  permissionMode: PermissionModeSchema.describe("Current permission mode for MCP tool calls."),
});

type EngineRuntimeStateFromSchema = z.infer<typeof EngineRuntimeStateSchema>;

// Omitting conversation starts a new Conversation; id/URL resumes an existing one.
export const FanoutTaskSchema = z.object({
  prompt: z.string().min(1).describe("Prompt to send in this Conversation."),
  provider: z
    .string()
    .optional()
    .describe("Provider id (e.g. 'chatgpt'); omit for the default fan-out provider."),
  conversation: z
    .string()
    .optional()
    .describe("Existing Conversation id or URL to resume; omit to start a new Conversation."),
  label: z.string().optional().describe("Caller label echoed back on this task's fan-out row."),
  isolate: z
    .string()
    .optional()
    .describe("Isolated profile name; drives this task in a separate signed-in Chrome."),
});

export type FanoutTask = z.infer<typeof FanoutTaskSchema>;

export const FanoutTasksSchema = z
  .array(FanoutTaskSchema)
  .min(1)
  .describe("Ordered fan-out tasks; one fan-out row per task.");

type FanoutTasksInput = z.infer<typeof FanoutTasksSchema>;

const FanoutOptionsSchema = z.object({
  maxConcurrency: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Max Conversations in flight at once (default 1 — serial)."),
  timeoutMs: z.number().positive().optional().describe("Per-task reply timeout in ms."),
  maxReplyChars: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Truncate each reply to this many characters for context safety."),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Max tasks to run and return per call (pagination window)."),
  offset: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Skip this many tasks before running (pagination cursor)."),
});

type FanoutOptionsInput = z.infer<typeof FanoutOptionsSchema>;
