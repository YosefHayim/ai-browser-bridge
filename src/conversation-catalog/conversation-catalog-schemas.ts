import { z } from "zod";

const CONVERSATION_SEARCH_SOURCES = ["providerSearch", "sidebar"] as const;

const ConversationSearchSourceSchema = z.enum(CONVERSATION_SEARCH_SOURCES);

export type ConversationSearchSource = z.infer<typeof ConversationSearchSourceSchema>;

const ConversationSearchInputSchema = z.object({
  query: z.string(),
  limit: z.number().optional(),
});

const ConversationSearchResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  provider: z.string(),
  source: ConversationSearchSourceSchema,
  score: z.number(),
});

const ConversationSearchResponseSchema = z.object({
  query: z.string(),
  results: z.array(ConversationSearchResultSchema),
});

export type ConversationSearchInput = z.infer<typeof ConversationSearchInputSchema>;
export type ConversationSearchResult = z.infer<typeof ConversationSearchResultSchema>;
type ConversationSearchResponse = z.infer<typeof ConversationSearchResponseSchema>;
