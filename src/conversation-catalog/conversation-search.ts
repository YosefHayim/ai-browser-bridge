import type { Page } from "playwright";
import type { Conversation } from "@/domain/message-types.ts";
import type {
  ConversationSearchInput,
  ConversationSearchResult,
  ConversationSearchSource,
} from "./conversation-catalog-schemas.ts";

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
  const limit = readConversationSearchLimit(input.limit);
  const conversationSearchInput: ConversationSearchInput = {
    query: input.query,
    limit,
  };
  const providerSearch = input.provider.searchConversations;

  const hasProviderSearch = providerSearch !== undefined;
  if (hasProviderSearch) {
    const providerSearchHits = await providerSearch(input.page, conversationSearchInput);

    const hasProviderSearchHits = providerSearchHits.length > 0;
    if (hasProviderSearchHits) {
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
  const limit = readConversationSearchLimit(input.limit);
  const query = readConversationSearchText(input.query);

  const scoredConversations: ScoredConversation[] = [];
  for (const [index, conversation] of input.conversations.entries()) {
    const score = scoreConversation(conversation, query);
    const isQueryWithoutMatch = query.length > 0 && score === 0;
    if (isQueryWithoutMatch) continue;

    scoredConversations.push({ conversation, index, score });
  }

  scoredConversations.sort(compareScoredConversations);

  return scoredConversations
    .slice(0, limit)
    .map((scoredConversation) =>
      readConversationSearchResult(scoredConversation, input.provider, input.source),
    );
};

const readConversationSearchLimit = (limit: number | undefined): number => {
  const isLimitInvalid = limit === undefined || !Number.isFinite(limit) || limit <= 0;
  if (isLimitInvalid) {
    return DEFAULT_CONVERSATION_SEARCH_LIMIT;
  }

  const wholeLimit = Math.floor(limit);
  return Math.min(wholeLimit, MAX_CONVERSATION_SEARCH_LIMIT);
};

const readConversationSearchText = (rawText: string): string => rawText.trim().toLowerCase();

const scoreConversation = (conversation: Conversation, query: string): number => {
  const isQueryEmpty = query.length === 0;
  if (isQueryEmpty) return 0;

  const title = readConversationSearchText(conversation.title);

  const id = readConversationSearchText(conversation.id);
  const isExactIdMatch = id === query;
  if (isExactIdMatch) return EXACT_CONVERSATION_ID_SCORE;

  const isExactTitleMatch = title === query;
  if (isExactTitleMatch) return EXACT_CONVERSATION_TITLE_SCORE;

  const isQueryInId = id.includes(query);
  if (isQueryInId) return CONVERSATION_ID_SUBSTRING_SCORE;

  const isQueryInTitle = title.includes(query);
  if (isQueryInTitle) return CONVERSATION_TITLE_SUBSTRING_SCORE;

  const tokens = query.split(/\s+/).filter((token) => token.length > 0);

  const matchedTokenCount = tokens.filter(
    (token) => title.includes(token) || id.includes(token),
  ).length;
  const hasNoTokenMatch = matchedTokenCount === 0;
  if (hasNoTokenMatch) return 0;

  return matchedTokenCount * CONVERSATION_TOKEN_MATCH_SCORE;
};

const compareScoredConversations = (
  left: ScoredConversation,
  right: ScoredConversation,
): number => {
  const isScoreDifferent = right.score !== left.score;
  if (isScoreDifferent) return right.score - left.score;

  return left.index - right.index;
};

const readConversationSearchResult = (
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
