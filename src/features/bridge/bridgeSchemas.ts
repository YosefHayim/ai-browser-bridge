import { Schema } from "effect";

import { PermissionModeSchema } from "@/features/domain";

export const StartEngineOptionsSchema = Schema.Struct({
  repoPath: Schema.optional(Schema.String).annotations({
    description: "Target repository the MCP tools operate inside.",
  }),
  provider: Schema.optional(Schema.String).annotations({
    description: "Browser provider (e.g. 'chatgpt' or 'gemini').",
  }),
  mcpPort: Schema.optional(Schema.Number).annotations({
    description: "MCP server port. Defaults to the saved port or 8765.",
  }),
  withBrowser: Schema.optional(Schema.Boolean).annotations({
    description: "Launch/attach Chrome.",
  }),
  debugPort: Schema.optional(Schema.Number).annotations({
    description:
      "Chrome remote-debugging port to attach/spawn on. Defaults to the shared bridge port (9222).",
  }),
  profileRoot: Schema.optional(Schema.String).annotations({
    description:
      "Chrome user-data-dir to attach/spawn. Defaults to the shared bridge profile root.",
  }),
  withTools: Schema.optional(Schema.Boolean).annotations({
    description: "Start the local MCP server. Defaults to true.",
  }),
  withTunnel: Schema.optional(Schema.Boolean).annotations({
    description: "Start the Cloudflare tunnel + sync the ChatGPT connector.",
  }),
  persist: Schema.optional(Schema.Boolean).annotations({
    description: "Persist repo-local config, sessions, logs, and checkpoints under `.bridge/`.",
  }),
});

export type StartEngineOptionsFromSchema = Schema.Schema.Type<typeof StartEngineOptionsSchema>;

export const AskEngineInputSchema = Schema.Struct({
  content: Schema.String.pipe(Schema.minLength(1)).annotations({
    description: "User prompt text.",
  }),
  timeoutMs: Schema.optional(Schema.Number.pipe(Schema.positive())).annotations({
    description: "Optional timeout override in milliseconds.",
  }),
  expectImages: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())).annotations({
    description: "Number of generated images to wait for before returning (ChatGPT only).",
  }),
});

export type AskEngineInputFromSchema = Schema.Schema.Type<typeof AskEngineInputSchema>;

export const ShutdownEngineInputSchema = Schema.Struct({
  closeBrowser: Schema.optional(Schema.Boolean).annotations({
    description: "Whether to close the browser on shutdown.",
  }),
});

export type ShutdownEngineInputFromSchema = Schema.Schema.Type<typeof ShutdownEngineInputSchema>;

export const EngineRuntimeStateSchema = Schema.Struct({
  sessionId: Schema.String.annotations({
    description: "Active session id for persistence.",
  }),
  permissionMode: PermissionModeSchema.annotations({
    description: "Current permission mode for MCP tool calls.",
  }),
});

export type EngineRuntimeStateFromSchema = Schema.Schema.Type<typeof EngineRuntimeStateSchema>;

// Omitting conversation starts a new Conversation; id/URL resumes an existing one.
export const FanoutTaskSchema = Schema.Struct({
  prompt: Schema.String.pipe(Schema.minLength(1)).annotations({
    description: "Prompt to send in this Conversation.",
  }),
  provider: Schema.optional(Schema.String).annotations({
    description: "Provider id (e.g. 'chatgpt'); omit for the default fan-out provider.",
  }),
  conversation: Schema.optional(Schema.String).annotations({
    description: "Existing Conversation id or URL to resume; omit to start a new Conversation.",
  }),
  label: Schema.optional(Schema.String).annotations({
    description: "Caller label echoed back on this task's fan-out row.",
  }),
  isolate: Schema.optional(Schema.String).annotations({
    description: "Isolated profile name; drives this task in a separate signed-in Chrome.",
  }),
});

export type FanoutTask = typeof FanoutTaskSchema.Type;

export const FanoutTasksSchema = Schema.Array(FanoutTaskSchema)
  .pipe(Schema.minItems(1))
  .annotations({ description: "Ordered fan-out tasks; one fan-out row per task." });

export type FanoutTasksInput = typeof FanoutTasksSchema.Type;

export const FanoutOptionsSchema = Schema.Struct({
  maxConcurrency: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())).annotations({
    description: "Max Conversations in flight at once (default 1 — serial).",
  }),
  timeoutMs: Schema.optional(Schema.Number.pipe(Schema.positive())).annotations({
    description: "Per-task reply timeout in ms.",
  }),
  maxReplyChars: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())).annotations({
    description: "Truncate each reply to this many characters for context safety.",
  }),
  limit: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())).annotations({
    description: "Max tasks to run and return per call (pagination window).",
  }),
  offset: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())).annotations({
    description: "Skip this many tasks before running (pagination cursor).",
  }),
});

export type FanoutOptionsInput = typeof FanoutOptionsSchema.Type;
