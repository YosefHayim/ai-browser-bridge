import type { Response } from "playwright";
import { z } from "zod";
import type { ConversationSearchReport } from "@/conversation-catalog/conversation-catalog-schemas.ts";
import { readChatGptConversationIdFromUrl } from "@/providers/chatgpt/backend-api/chatgpt-conversation-url.ts";

const chatGptOriginUrl = "https://chatgpt.com";
const topSearchScore = 100;

export const CHATGPT_SEARCH = {
  trigger: 'button[aria-label="Search"]',
  dialog: '[role="dialog"]:has(button[aria-label="Close global search"])',
  input: 'input[role="combobox"]',
  resultLink: 'a[href*="/c/"]',
  resultTitle: '[data-testid="global-search-result-preview-trigger"] + span > span:first-child',
  rateLimit: "#modal-conversation-history-rate-limit",
  searchEndpoint: "/backend-api/global/search",
} as const;

export type ChatGptSearchLine = {
  readonly href: string;
  readonly title: string;
};

type GlobalSearchReplyHit = {
  readonly response: Response;
  readonly query: string;
};

type SearchLineQueryHit = {
  readonly entry: ChatGptSearchLine;
  readonly query: string;
};

const globalSearchRequestSchema = z.object({ query: z.string() });

const globalSearchReportsSchema = z.object({
  items: z.array(z.object({ source_type: z.string() })),
});

export function readChatGptSearchReport(
  line: ChatGptSearchLine,
  index: number,
): ConversationSearchReport | null {
  const conversationId = readChatGptConversationIdFromUrl(line.href);

  const title = line.title.trim();

  const isConversationIncomplete = conversationId == null || !title;
  if (isConversationIncomplete) return null;

  return {
    id: conversationId,
    title,
    url: new URL(line.href, chatGptOriginUrl).toString(),
    provider: "chatgpt",
    source: "providerSearch",
    score: Math.max(1, topSearchScore - index),
  };
}

// Not JSON means the request is not a search request, so the caller sees no match.
function parseReplyOrNull(serializedReply: string): unknown {
  try {
    return JSON.parse(serializedReply);
  } catch (error) {
    const isReplyMalformed = error instanceof SyntaxError;
    if (isReplyMalformed) return null;

    throw error;
  }
}

export function isGlobalSearchReplyFor(hit: GlobalSearchReplyHit): boolean {
  const replyUrlAddress = hit.response.url();
  const replyUrl = new URL(replyUrlAddress);

  const isSearchEndpointWrong = replyUrl.pathname !== CHATGPT_SEARCH.searchEndpoint;
  if (isSearchEndpointWrong) return false;

  const requestFields = hit.response.request().postData();

  const isThereNoRequestFields = requestFields == null;
  if (isThereNoRequestFields) return false;

  const parsedRequestFields = parseReplyOrNull(requestFields);
  const searchRequestReply = globalSearchRequestSchema.safeParse(parsedRequestFields);
  return searchRequestReply.success && searchRequestReply.data.query === hit.query;
}

export function assertGlobalSearchSucceeded(searchReply: Response): void {
  const isSearchReplyOk = searchReply.ok();
  if (isSearchReplyOk) return;

  const status = searchReply.status();
  throw new Error(`ChatGPT conversation search failed with HTTP ${status}.`);
}

export function hasConversationHits(searchReplyFields: unknown): boolean {
  const searchReportsReply = globalSearchReportsSchema.safeParse(searchReplyFields);

  const isThereNoValidReply = !searchReportsReply.success;
  if (isThereNoValidReply) {
    throw new Error("ChatGPT conversation search returned an unexpected answer.");
  }

  return searchReportsReply.data.items.some(
    (searchReport) => searchReport.source_type === "conversation",
  );
}

export function isSearchLineForQuery(hit: SearchLineQueryHit): boolean {
  const lineUrl = new URL(hit.entry.href, chatGptOriginUrl);
  return lineUrl.searchParams.get("historySearchQuery") === hit.query;
}
