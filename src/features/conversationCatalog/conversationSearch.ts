import type { Page } from "playwright";
import type { Conversation } from "@/features/domain";
import type {
  ConversationSearchInput,
  ConversationSearchResult,
  ConversationSearchSource,
} from "./conversationCatalogSchemas.ts";

const DEFAULT_CONVERSATION_SEARCH_LIMIT = 20;
const MAX_CONVERSATION_SEARCH_LIMIT = 100;

const EXACT_CONVERSATION_ID_SCORE = 120;
const EXACT_CONVERSATION_TITLE_SCORE = 110;
const CONVERSATION_ID_SUBSTRING_SCORE = 100;
const CONVERSATION_TITLE_SUBSTRING_SCORE = 90;
const CONVERSATION_TOKEN_MATCH_SCORE = 10;

type SearchableConversationProvider = {
  readonly id: string;
  readonly readSidebarConversations: (page: Page) => Promise<ReadonlyArray<Conversation>>;
  readonly searchConversations?: (
    page: Page,
    input: ConversationSearchInput,
  ) => Promise<ReadonlyArray<ConversationSearchResult>>;
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
  readonly source: ConversationSearchSource;
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
    const providerSearchHits = await providerSearch(input.page, conversationSearchInput);
    if (providerSearchHits.length > 0) {
      return providerSearchHits.slice(0, limit);
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
  const query = conversationSearchText(input.query);

  const scoredConversations: ScoredConversation[] = [];
  for (const [index, conversation] of input.conversations.entries()) {
    const score = scoreConversation(conversation, query);
    if (query.length > 0 && score === 0) continue;
    scoredConversations.push({ conversation, index, score });
  }

  scoredConversations.sort(compareScoredConversations);

  return scoredConversations
    .slice(0, limit)
    .map((scoredConversation) =>
      conversationSearchResultFor(scoredConversation, input.provider, input.source),
    );
};

const conversationSearchLimit = (limit: number | undefined): number => {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_CONVERSATION_SEARCH_LIMIT;
  }
  return Math.min(Math.floor(limit), MAX_CONVERSATION_SEARCH_LIMIT);
};

const conversationSearchText = (rawText: string): string => rawText.trim().toLowerCase();

const scoreConversation = (conversation: Conversation, query: string): number => {
  if (query.length === 0) return 0;
  const title = conversationSearchText(conversation.title);
  const id = conversationSearchText(conversation.id);
  if (id === query) return EXACT_CONVERSATION_ID_SCORE;
  if (title === query) return EXACT_CONVERSATION_TITLE_SCORE;
  if (id.includes(query)) return CONVERSATION_ID_SUBSTRING_SCORE;
  if (title.includes(query)) return CONVERSATION_TITLE_SUBSTRING_SCORE;
  const tokens = query.split(/\s+/).filter((token) => token.length > 0);
  const matchedTokenCount = tokens.filter(
    (token) => title.includes(token) || id.includes(token),
  ).length;
  if (matchedTokenCount === 0) return 0;
  return matchedTokenCount * CONVERSATION_TOKEN_MATCH_SCORE;
};

const compareScoredConversations = (
  left: ScoredConversation,
  right: ScoredConversation,
): number => {
  if (right.score !== left.score) return right.score - left.score;
  return left.index - right.index;
};

const conversationSearchResultFor = (
  scoredConversation: ScoredConversation,
  provider: string,
  source: ConversationSearchSource,
): ConversationSearchResult => ({
  id: scoredConversation.conversation.id,
  title: scoredConversation.conversation.title,
  url: scoredConversation.conversation.url,
  provider,
  source,
  score: scoredConversation.score,
});
