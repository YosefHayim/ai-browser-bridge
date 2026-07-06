import { Schema } from "effect";

export const ConversationSearchInputSchema = Schema.Struct({
  query: Schema.String,
  limit: Schema.optional(Schema.Number),
});

export const ConversationSearchResultSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  url: Schema.String,
  provider: Schema.String,
  source: Schema.Literal("providerSearch", "sidebar"),
  score: Schema.Number,
});

export const ConversationSearchResponseSchema = Schema.Struct({
  query: Schema.String,
  results: Schema.Array(ConversationSearchResultSchema),
});

export type ConversationSearchInput = typeof ConversationSearchInputSchema.Type;
export type ConversationSearchResult = typeof ConversationSearchResultSchema.Type;
export type ConversationSearchResponse = typeof ConversationSearchResponseSchema.Type;
