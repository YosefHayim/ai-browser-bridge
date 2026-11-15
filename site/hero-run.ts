import { z } from "zod";

const HeroRunProviderSchema = z.object({
  id: z.string(),
  label: z.string(),
  host: z.string(),
  replyText: z.string(),
  replyTokens: z.number(),
  pageHtmlTokens: z.number(),
  durationMs: z.number().optional(),
});

export const HeroRunSchema = z.object({
  recordedAt: z.string(),
  bridgeVersion: z.string(),
  prompt: z.string(),
  command: z.string(),
  durationMs: z.number(),
  tokenizer: z.string(),
  providers: z.array(HeroRunProviderSchema).min(1),
});

export type HeroRun = z.infer<typeof HeroRunSchema>;

export type HeroRunProvider = HeroRun["providers"][number];
