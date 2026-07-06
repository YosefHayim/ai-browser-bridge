import type { Conversation } from "@/features/domain";
import type { Page } from "playwright";
import type {
  ConversationSearchInput,
  ConversationSearchResult,
} from "../conversationCatalogSchemas.ts";

const DEFAULT_LIMIT = 20;

interface SearchableConversationProvider {
  id: string;
  readSidebarConversations(page: Page): Promise<Conversation[]>;
  searchConversations?(
    page: Page,
    input: ConversationSearchInput,
  ): Promise<ConversationSearchResult[]>;
}

interface RankConversationsInput {
  conversations: Conversation[];
  provider: string;
  query: string;
  source: ConversationSearchResult["source"];
  limit?: number;
}

/**
 * Search conversations through a provider capability, with sidebar filtering fallback.
 *
 * @param input - Input values for the operation.
 * @returns The `searchConversations` result.
 * @example
 * ```ts
 * const result = await searchConversations(input);
 * ```
 */
export const searchConversations = async (input: {
  page: Page;
  provider: SearchableConversationProvider;
  query: string;
  limit?: number;
}): Promise<ConversationSearchResult[]> => {
  const request = { query: input.query, limit: normalizeLimit(input.limit) };
  if (input.provider.searchConversations) {
    const providerResults = await input.provider.searchConversations(input.page, request);
    if (providerResults.length > 0) return providerResults.slice(0, request.limit);
  }
  return rankConversations({
    conversations: await input.provider.readSidebarConversations(input.page),
    provider: input.provider.id,
    query: input.query,
    source: "sidebar",
    limit: request.limit,
  });
};

/**
 * Rank provider/sidebar conversation rows by id/title relevance.
 *
 * @param input - Input values for the operation.
 * @returns The `rankConversations` result.
 * @example
 * ```ts
 * const result = rankConversations(input);
 * ```
 */
export const rankConversations = (input: RankConversationsInput): ConversationSearchResult[] => {
  const limit = normalizeLimit(input.limit);
  const query = normalizeSearchText(input.query);
  const ranked = input.conversations
    .map((conversation, index) => ({
      conversation,
      index,
      score: scoreConversation(conversation, query),
    }))
    .filter((item) => query.length === 0 || item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit);
  return ranked.map((item) => ({
    id: item.conversation.id,
    title: item.conversation.title,
    url: item.conversation.url,
    provider: input.provider,
    source: input.source,
    score: item.score,
  }));
};

const normalizeLimit = (limit: number | undefined): number => {
  if (!limit || !Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), 100);
};

const normalizeSearchText = (value: string): string => {
  return value.trim().toLowerCase();
};

const scoreConversation = (conversation: Conversation, query: string): number => {
  if (!query) return 0;
  const title = normalizeSearchText(conversation.title);
  const id = normalizeSearchText(conversation.id);
  if (id === query) return 120;
  if (title === query) return 110;
  if (id.includes(query)) return 100;
  if (title.includes(query)) return 90;
  const tokens = query.split(/\s+/).filter(Boolean);
  const matched = tokens.filter((token) => title.includes(token) || id.includes(token)).length;
  return matched === 0 ? 0 : matched * 10;
};
