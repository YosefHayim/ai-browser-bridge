import { Schema } from "effect";

export const CONVERSATION_SEARCH_SOURCES = ["providerSearch", "sidebar"] as const;

export const ConversationSearchSourceSchema = Schema.Literal(...CONVERSATION_SEARCH_SOURCES);

export type ConversationSearchSource = typeof ConversationSearchSourceSchema.Type;

export const ConversationSearchInputSchema = Schema.Struct({
  query: Schema.String,
  limit: Schema.optional(Schema.Number),
});

export const ConversationSearchResultSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  url: Schema.String,
  provider: Schema.String,
  source: ConversationSearchSourceSchema,
  score: Schema.Number,
});

export const ConversationSearchResponseSchema = Schema.Struct({
  query: Schema.String,
  results: Schema.Array(ConversationSearchResultSchema),
});

export type ConversationSearchInput = typeof ConversationSearchInputSchema.Type;
export type ConversationSearchResult = typeof ConversationSearchResultSchema.Type;
export type ConversationSearchResponse = typeof ConversationSearchResponseSchema.Type;
