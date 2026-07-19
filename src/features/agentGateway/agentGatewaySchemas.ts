/**
 * Effect Schema definitions for the outbound MCP gateway (`bridge serve`).
 * Converted to MCP Zod shapes at registration via {@link effectSchemaToMcpShape}.
 *
 * @module
 */
import { FanoutTaskSchema } from "@/features/bridge";
import { Schema } from "effect";

// ---------------------------------------------------------------------------
// ask tool
// ---------------------------------------------------------------------------

/**
 * Schema for the `ask` tool parameters: a `prompt` fanned across `providers`, or a
 * parallel `tasks` array, with concurrency, timeout, and pagination knobs.
 */
export const AskToolArgsSchema = Schema.Struct({
  prompt: Schema.optional(Schema.String.pipe(Schema.minLength(1))).annotations({
    description: "Prompt to fan out across `providers`; omit when using `tasks`.",
  }),
  providers: Schema.optional(Schema.String).annotations({
    description: "Comma-separated provider ids (e.g. 'chatgpt,gemini'); omit for the default.",
  }),
  tasks: Schema.optional(Schema.Array(FanoutTaskSchema)).annotations({
    description: "Independent Conversations to run in parallel; overrides `prompt`/`providers`.",
  }),
  timeoutSeconds: Schema.optional(Schema.Number.pipe(Schema.positive())).annotations({
    description: "Per-task reply timeout in seconds.",
  }),
  maxConcurrency: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())).annotations({
    description: "Max Conversations in flight at once (default 1 — serial).",
  }),
  limit: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())).annotations({
    description: "Max tasks to run and return per call (pagination window).",
  }),
  offset: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())).annotations({
    description: "Tasks to skip before running (pagination cursor).",
  }),
  maxReplyChars: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())).annotations({
    description: "Truncate each reply to this many characters for context safety.",
  }),
});

export type AskToolArgs = Schema.Schema.Type<typeof AskToolArgsSchema>;

export const AskToolResultSchema = Schema.Struct({
  ok: Schema.Boolean,
  output: Schema.String,
});

export type AskToolResult = Schema.Schema.Type<typeof AskToolResultSchema>;

// ---------------------------------------------------------------------------
// search_conversations
// ---------------------------------------------------------------------------

export const SearchConversationsArgsSchema = Schema.Struct({
  query: Schema.String.pipe(Schema.minLength(1)).annotations({
    description: "Title/id text to search for in provider conversation history.",
  }),
  providers: Schema.optional(Schema.String).annotations({
    description: "Comma-separated provider ids (e.g. 'chatgpt,gemini'); omit for the default.",
  }),
  limit: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())).annotations({
    description: "Maximum results per provider.",
  }),
});

export type SearchConversationsArgs = Schema.Schema.Type<typeof SearchConversationsArgsSchema>;

// ---------------------------------------------------------------------------
// chatgpt recon
// ---------------------------------------------------------------------------

export const ChatgptRenderStateArgsSchema = Schema.Struct({
  allTabs: Schema.optional(Schema.Boolean).annotations({
    description: "Report every ChatGPT tab in the browser instead of just the active one.",
  }),
});

export type ChatgptRenderStateArgs = Schema.Schema.Type<typeof ChatgptRenderStateArgsSchema>;

// ---------------------------------------------------------------------------
// flow tools
// ---------------------------------------------------------------------------

const ClipIdField = Schema.String.pipe(Schema.minLength(1)).annotations({
  description: "Clip id from flow_list_clips.",
});

const ConfirmField = Schema.optional(Schema.Boolean).annotations({
  description: "Must be true to run this irreversible-ish action.",
});

export const FlowGenerateArgsSchema = Schema.Struct({
  startFramePath: Schema.String.pipe(Schema.minLength(1)).annotations({
    description: "Local path to the Start keyframe image.",
  }),
  prompt: Schema.String.pipe(Schema.minLength(1)).annotations({
    description: "Shot / motion prompt for the clip.",
  }),
  outDir: Schema.optional(
    Schema.String.annotations({ description: "Download directory (default ./downloads/flow)." }),
  ),
  download: Schema.optional(
    Schema.Boolean.annotations({ description: "Set false to skip downloading the mp4." }),
  ),
});

export const FlowListClipsArgsSchema = Schema.Struct({});
export const FlowListProjectsArgsSchema = Schema.Struct({});

export const FlowDownloadClipsArgsSchema = Schema.Struct({
  clipIds: Schema.optional(
    Schema.Array(Schema.String).annotations({
      description: "Clip ids to download; omit for all.",
    }),
  ),
  outDir: Schema.optional(
    Schema.String.annotations({ description: "Output directory (default ./downloads/flow)." }),
  ),
});

export const FlowDeleteClipArgsSchema = Schema.Struct({
  clipId: ClipIdField,
  confirm: ConfirmField,
});

export const FlowRenameClipArgsSchema = Schema.Struct({
  clipId: ClipIdField,
  name: Schema.String.pipe(Schema.minLength(1)).annotations({ description: "New clip name." }),
});

export const FlowExtendClipArgsSchema = Schema.Struct({ clipId: ClipIdField });
export const FlowReuseClipArgsSchema = Schema.Struct({ clipId: ClipIdField });

export const FlowRenameProjectArgsSchema = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(1)).annotations({ description: "New project name." }),
});

export const FlowDeleteProjectArgsSchema = Schema.Struct({ confirm: ConfirmField });
export const FlowListIngredientsArgsSchema = Schema.Struct({});

export const FlowRemoveIngredientArgsSchema = Schema.Struct({
  ingredientId: Schema.String.pipe(Schema.minLength(1)).annotations({
    description: "Ingredient media id from flow_list_ingredients.",
  }),
});

export const FlowClearIngredientsArgsSchema = Schema.Struct({});
