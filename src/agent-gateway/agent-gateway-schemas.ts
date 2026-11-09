import { z } from "zod";
import { FanoutTaskSchema } from "@/bridge/bridge-schemas.ts";

export const AskToolArgsSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .optional()
    .describe("Prompt to fan out across `providers`; omit when using `tasks`."),
  providers: z
    .string()
    .optional()
    .describe("Comma-separated provider ids (e.g. 'chatgpt,gemini'); omit for the default."),
  tasks: z
    .array(FanoutTaskSchema)
    .optional()
    .describe("Independent Conversations to run in parallel; overrides `prompt`/`providers`."),
  timeoutSeconds: z.number().positive().optional().describe("Per-task reply timeout in seconds."),
  maxConcurrency: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Max Conversations in flight at once (default 1 — serial)."),
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
    .describe("Tasks to skip before running (pagination cursor)."),
  maxReplyChars: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Truncate each reply to this many characters for context safety."),
});

export type AskToolArgs = z.infer<typeof AskToolArgsSchema>;

const AskToolResultSchema = z.object({
  ok: z.boolean(),
  output: z.string(),
});

export type AskToolResult = z.infer<typeof AskToolResultSchema>;

export const SearchConversationsArgsSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe("Title/id text to search for in provider conversation history."),
  providers: z
    .string()
    .optional()
    .describe("Comma-separated provider ids (e.g. 'chatgpt,gemini'); omit for the default."),
  limit: z.number().int().positive().optional().describe("Maximum results per provider."),
});

export type SearchConversationsArgs = z.infer<typeof SearchConversationsArgsSchema>;

export const ChatgptRenderStateArgsSchema = z.object({
  allTabs: z
    .boolean()
    .optional()
    .describe("Report every ChatGPT tab in the browser instead of just the active one."),
});

const ClipIdField = z.string().min(1).describe("Clip id from flow_list_clips.");

const ConfirmField = z
  .boolean()
  .optional()
  .describe("Must be true to run this irreversible-ish action.");

export const FlowGenerateArgsSchema = z.object({
  startFramePath: z.string().min(1).describe("Local path to the Start keyframe image."),
  prompt: z.string().min(1).describe("Shot / motion prompt for the clip."),
  outDir: z
    .string()
    .describe("Download directory (default <repo>/.bridge/downloads/flow).")
    .optional(),
  download: z.boolean().describe("Set false to skip downloading the mp4.").optional(),
});

export const FlowListClipsArgsSchema = z.object({});
export const FlowListProjectsArgsSchema = z.object({});

export const FlowDownloadClipsArgsSchema = z.object({
  clipIds: z.array(z.string()).describe("Clip ids to download; omit for all.").optional(),
  outDir: z
    .string()
    .describe("Output directory (default <repo>/.bridge/downloads/flow).")
    .optional(),
});

export const FlowDeleteClipArgsSchema = z.object({
  clipId: ClipIdField,
  confirm: ConfirmField,
});

export const FlowRenameClipArgsSchema = z.object({
  clipId: ClipIdField,
  name: z.string().min(1).describe("New clip name."),
});

export const FlowExtendClipArgsSchema = z.object({ clipId: ClipIdField });
export const FlowReuseClipArgsSchema = z.object({ clipId: ClipIdField });

export const FlowRenameProjectArgsSchema = z.object({
  name: z.string().min(1).describe("New project name."),
});

export const FlowDeleteProjectArgsSchema = z.object({ confirm: ConfirmField });
export const FlowListIngredientsArgsSchema = z.object({});

export const FlowRemoveIngredientArgsSchema = z.object({
  ingredientId: z.string().min(1).describe("Ingredient media id from flow_list_ingredients."),
});

export const FlowClearIngredientsArgsSchema = z.object({});
