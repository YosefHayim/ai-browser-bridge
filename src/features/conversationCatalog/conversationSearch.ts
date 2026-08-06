import type { Page } from "playwright";
import type { Conversation } from "@/features/domain";
import type {
  ConversationSearchInput,
  ConversationSearchResult,
} from "./conversationCatalogSchemas.ts";

const DEFAULT_CONVERSATION_SEARCH_LIMIT = 20;
const MAX_CONVERSATION_SEARCH_LIMIT = 100;

type SearchableConversationProvider = {
  readonly id: string;
  readonly readSidebarConversations: (page: Page) => Promise<Conversation[]>;
  readonly searchConversations?: (
    page: Page,
    input: ConversationSearchInput,
  ) => Promise<ConversationSearchResult[]>;
};

type SearchConversationsInput = {
  readonly page: Page;
  readonly provider: SearchableConversationProvider;
  readonly query: string;
  readonly limit?: number;
};

type RankConversationsInput = {
  readonly conversations: ReadonlyArray<Conversation>;
  readonly provider: string;
  readonly query: string;
  readonly source: ConversationSearchResult["source"];
  readonly limit?: number;
};

type ScoredConversation = {
  readonly conversation: Conversation;
  readonly index: number;
  readonly score: number;
};

export const searchConversations = async (
  input: SearchConversationsInput,
): Promise<ConversationSearchResult[]> => {
  const limit = conversationSearchLimit(input.limit);
  const conversationSearchInput: ConversationSearchInput = {
    query: input.query,
    limit,
  };
  const providerSearch = input.provider.searchConversations;
  if (providerSearch !== undefined) {
    const providerResults = await providerSearch(input.page, conversationSearchInput);
    if (providerResults.length > 0) {
      return providerResults.slice(0, limit);
    }
  }
  return rankConversations({
    conversations: await input.provider.readSidebarConversations(input.page),
    provider: input.provider.id,
    query: input.query,
    source: "sidebar",
    limit,
  });
};

export const rankConversations = (input: RankConversationsInput): ConversationSearchResult[] => {
  const limit = conversationSearchLimit(input.limit);
  const query = searchText(input.query);

  const scoredConversations: ScoredConversation[] = [];
  for (const [index, conversation] of input.conversations.entries()) {
    const score = scoreConversation(conversation, query);
    if (query.length > 0 && score === 0) continue;
    scoredConversations.push({ conversation, index, score });
  }

  scoredConversations.sort(compareScoredConversations);

  return scoredConversations.slice(0, limit).map((scored) => ({
    id: scored.conversation.id,
    title: scored.conversation.title,
    url: scored.conversation.url,
    provider: input.provider,
    source: input.source,
    score: scored.score,
  }));
};

const conversationSearchLimit = (limit: number | undefined): number => {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_CONVERSATION_SEARCH_LIMIT;
  }
  return Math.min(Math.floor(limit), MAX_CONVERSATION_SEARCH_LIMIT);
};

const searchText = (text: string): string => text.trim().toLowerCase();

const scoreConversation = (conversation: Conversation, query: string): number => {
  if (query.length === 0) return 0;
  const title = searchText(conversation.title);
  const id = searchText(conversation.id);
  if (id === query) return 120;
  if (title === query) return 110;
  if (id.includes(query)) return 100;
  if (title.includes(query)) return 90;
  const tokens = query.split(/\s+/).filter((token) => token.length > 0);
  const matchedTokenCount = tokens.filter(
    (token) => title.includes(token) || id.includes(token),
  ).length;
  if (matchedTokenCount === 0) return 0;
  return matchedTokenCount * 10;
};

const compareScoredConversations = (
  left: ScoredConversation,
  right: ScoredConversation,
): number => {
  if (right.score !== left.score) return right.score - left.score;
  return left.index - right.index;
};
