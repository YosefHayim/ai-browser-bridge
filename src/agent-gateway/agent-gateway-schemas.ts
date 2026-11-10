import { z } from "zod";
import { FanoutTaskSchema } from "@/bridge/bridge-schemas.ts";

const PROVIDER_IDS_DESCRIPTION =
  "Comma-separated provider ids (e.g. 'chatgpt,gemini'); omit for the default.";

export const AskToolArgumentsSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .optional()
    .describe("Prompt to fan out across `providers`; omit when using `tasks`."),
  providers: z.string().optional().describe(PROVIDER_IDS_DESCRIPTION),
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

export type AskToolArguments = z.infer<typeof AskToolArgumentsSchema>;

const AskToolReportSchema = z.object({
  ok: z.boolean(),
  output: z.string(),
});

export type AskToolReport = z.infer<typeof AskToolReportSchema>;

export const SearchConversationsArgumentsSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe("Title/id text to search for in provider conversation history."),
  providers: z.string().optional().describe(PROVIDER_IDS_DESCRIPTION),
  limit: z.number().int().positive().optional().describe("Maximum results per provider."),
});

export type SearchConversationsArguments = z.infer<typeof SearchConversationsArgumentsSchema>;

export const ChatgptRenderStatusArgumentsSchema = z.object({
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

export const FlowGenerateArgumentsSchema = z.object({
  startFramePath: z.string().min(1).describe("Local path to the Start keyframe image."),
  prompt: z.string().min(1).describe("Shot / motion prompt for the clip."),
  outDir: z
    .string()
    .describe("Download directory (default <repo>/.bridge/downloads/flow).")
    .optional(),
  download: z.boolean().describe("Set false to skip downloading the mp4.").optional(),
});

export const FlowListClipsArgumentsSchema = z.object({});
export const FlowListProjectsArgumentsSchema = z.object({});

export const FlowDownloadClipsArgumentsSchema = z.object({
  clipIds: z.array(z.string()).describe("Clip ids to download; omit for all.").optional(),
  outDir: z
    .string()
    .describe("Output directory (default <repo>/.bridge/downloads/flow).")
    .optional(),
});

export const FlowDeleteClipArgumentsSchema = z.object({
  clipId: ClipIdField,
  confirm: ConfirmField,
});

export const FlowRenameClipArgumentsSchema = z.object({
  clipId: ClipIdField,
  name: z.string().min(1).describe("New clip name."),
});

export const FlowExtendClipArgumentsSchema = z.object({ clipId: ClipIdField });
export const FlowReuseClipArgumentsSchema = z.object({ clipId: ClipIdField });

export const FlowRenameProjectArgumentsSchema = z.object({
  name: z.string().min(1).describe("New project name."),
});

export const FlowDeleteProjectArgumentsSchema = z.object({ confirm: ConfirmField });
export const FlowListIngredientsArgumentsSchema = z.object({});

export const FlowRemoveIngredientArgumentsSchema = z.object({
  ingredientId: z.string().min(1).describe("Ingredient media id from flow_list_ingredients."),
});

export const FlowClearIngredientsArgumentsSchema = z.object({});
