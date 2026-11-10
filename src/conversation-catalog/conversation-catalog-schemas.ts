import { z } from "zod";

const CONVERSATION_SEARCH_ORIGINS = ["providerSearch", "sidebar"] as const;

const ConversationSearchOriginSchema = z.enum(CONVERSATION_SEARCH_ORIGINS);

export type ConversationSearchOrigin = z.infer<typeof ConversationSearchOriginSchema>;

const ConversationSearchDetailsSchema = z.object({
  query: z.string(),
  limit: z.number().optional(),
});

const ConversationSearchReportSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  provider: z.string(),
  source: ConversationSearchOriginSchema,
  score: z.number(),
});

export type ConversationSearchDetails = z.infer<typeof ConversationSearchDetailsSchema>;
export type ConversationSearchReport = z.infer<typeof ConversationSearchReportSchema>;
