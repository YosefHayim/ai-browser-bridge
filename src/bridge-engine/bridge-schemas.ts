import { z } from "zod";

export const FanOutTaskSchema = z.object({
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

export type FanOutTask = z.infer<typeof FanOutTaskSchema>;

export const FanOutTasksSchema = z
  .array(FanOutTaskSchema)
  .min(1)
  .describe("Ordered fan-out tasks; one fan-out row per task.");
