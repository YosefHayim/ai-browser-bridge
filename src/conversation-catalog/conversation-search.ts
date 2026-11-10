import type { Page } from "playwright";
import type { Conversation } from "@/domain/message-types.ts";
import type {
  ConversationSearchDetails,
  ConversationSearchOrigin,
  ConversationSearchReport,
} from "./conversation-catalog-schemas.ts";

const DEFAULT_CONVERSATION_SEARCH_LIMIT = 20;
const MAX_CONVERSATION_SEARCH_LIMIT = 100;

const EXACT_CONVERSATION_ID_SCORE = 120;
const EXACT_CONVERSATION_TITLE_SCORE = 110;
const CONVERSATION_ID_SUBSTRING_SCORE = 100;
const CONVERSATION_TITLE_SUBSTRING_SCORE = 90;
const CONVERSATION_TOKEN_HIT_SCORE = 10;

type SearchableConversationProvider = {
  readonly id: string;
  readonly readSidebarConversations: (page: Page) => Promise<ReadonlyArray<Conversation>>;
  readonly searchConversations?: (
    page: Page,
    details: ConversationSearchDetails,
  ) => Promise<ReadonlyArray<ConversationSearchReport>>;
};

type SearchConversationsDetails = {
  readonly page: Page;
  readonly provider: SearchableConversationProvider;
  readonly query: string;
  readonly limit?: number;
};

type RankConversationsDetails = {
  readonly conversations: ReadonlyArray<Conversation>;
  readonly provider: string;
  readonly query: string;
  readonly source: ConversationSearchOrigin;
  readonly limit?: number;
};

type ScoredConversation = {
  readonly conversation: Conversation;
  readonly index: number;
  readonly score: number;
};

export const searchConversations = async (
  details: SearchConversationsDetails,
): Promise<ConversationSearchReport[]> => {
  const limit = readConversationSearchLimit(details.limit);
  const conversationSearchDetails: ConversationSearchDetails = {
    query: details.query,
    limit,
  };
  const providerSearch = details.provider.searchConversations;

  const hasProviderSearch = providerSearch != null;
  if (hasProviderSearch) {
    const providerSearchHits = await providerSearch(details.page, conversationSearchDetails);

    const hasProviderSearchHits = providerSearchHits.length > 0;
    if (hasProviderSearchHits) {
      return providerSearchHits.slice(0, limit);
    }
  }

  return rankConversations({
    conversations: await details.provider.readSidebarConversations(details.page),
    provider: details.provider.id,
    query: details.query,
    source: "sidebar",
    limit,
  });
};

export const rankConversations = (
  details: RankConversationsDetails,
): ConversationSearchReport[] => {
  const limit = readConversationSearchLimit(details.limit);
  const query = trimAndLowerCase(details.query);

  const scoredConversations: ScoredConversation[] = [];
  for (const [index, conversation] of details.conversations.entries()) {
    const score = scoreConversation(conversation, query);
    const isConversationNotFound = query.length > 0 && score === 0;
    if (isConversationNotFound) continue;

    scoredConversations.push({ conversation, index, score });
  }

  scoredConversations.sort(compareScoredConversations);

  return scoredConversations
    .slice(0, limit)
    .map((scoredConversation) =>
      readConversationSearchReport(scoredConversation, details.provider, details.source),
    );
};

const readConversationSearchLimit = (limit: number | undefined): number => {
  const isLimitInvalid = limit == null || !Number.isFinite(limit) || limit <= 0;
  if (isLimitInvalid) {
    return DEFAULT_CONVERSATION_SEARCH_LIMIT;
  }

  const wholeLimit = Math.floor(limit);
  return Math.min(wholeLimit, MAX_CONVERSATION_SEARCH_LIMIT);
};

const trimAndLowerCase = (phrase: string): string => phrase.trim().toLowerCase();

const scoreConversation = (conversation: Conversation, query: string): number => {
  const isQueryEmpty = query.length === 0;
  if (isQueryEmpty) return 0;

  const title = trimAndLowerCase(conversation.title);

  const id = trimAndLowerCase(conversation.id);
  const isExactIdFound = id === query;
  if (isExactIdFound) return EXACT_CONVERSATION_ID_SCORE;

  const isExactTitleFound = title === query;
  if (isExactTitleFound) return EXACT_CONVERSATION_TITLE_SCORE;

  const isQueryInId = id.includes(query);
  if (isQueryInId) return CONVERSATION_ID_SUBSTRING_SCORE;

  const isQueryInTitle = title.includes(query);
  if (isQueryInTitle) return CONVERSATION_TITLE_SUBSTRING_SCORE;

  const tokens = query.split(/\s+/).filter((token) => token.length > 0);

  const matchedTokenCount = tokens.filter(
    (token) => title.includes(token) || id.includes(token),
  ).length;
  const hasNoMatchingToken = matchedTokenCount === 0;
  if (hasNoMatchingToken) return 0;

  return matchedTokenCount * CONVERSATION_TOKEN_HIT_SCORE;
};

const compareScoredConversations = (
  left: ScoredConversation,
  right: ScoredConversation,
): number => {
  const isScoreDifferent = right.score !== left.score;
  if (isScoreDifferent) return right.score - left.score;

  return left.index - right.index;
};

const readConversationSearchReport = (
  scoredConversation: ScoredConversation,
  provider: string,
  origin: ConversationSearchOrigin,
): ConversationSearchReport => ({
  id: scoredConversation.conversation.id,
  title: scoredConversation.conversation.title,
  url: scoredConversation.conversation.url,
  provider,
  source: origin,
  score: scoredConversation.score,
});
