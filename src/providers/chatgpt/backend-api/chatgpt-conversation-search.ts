import type { Page } from "playwright";
import type {
  ConversationSearchDetails,
  ConversationSearchReport,
} from "@/conversation-catalog/conversation-catalog-schemas.ts";
import { ChatGptSearchDialog } from "@/providers/chatgpt/backend-api/chatgpt-search-dialog.ts";
import {
  assertGlobalSearchSucceeded,
  CHATGPT_SEARCH,
  hasConversationHits,
  isGlobalSearchReplyFor,
} from "@/providers/chatgpt/backend-api/chatgpt-search-replies.ts";

const defaultSearchLimit = 20;
const searchReplyMilliseconds = 15_000;
const typingDelayMilliseconds = 25;

export async function searchChatGptConversations(
  page: Page,
  request: ConversationSearchDetails,
): Promise<ConversationSearchReport[]> {
  const query = request.query.trim();

  const isQueryEmpty = !query;
  if (isQueryEmpty) return [];

  const limit = request.limit ?? defaultSearchLimit;
  const searchDialog = new ChatGptSearchDialog(page);
  try {
    const dialog = await searchDialog.open();
    await searchDialog.assertAvailable();
    const field = dialog.locator(CHATGPT_SEARCH.input).first();
    await field.fill("");
    await field.focus();
    const searchReplyPromise = page.waitForResponse(
      (reply) => isGlobalSearchReplyFor({ response: reply, query }),
      { timeout: searchReplyMilliseconds },
    );

    await field.pressSequentially(query, { delay: typingDelayMilliseconds });
    const searchReply = await searchReplyPromise;
    assertGlobalSearchSucceeded(searchReply);

    const searchReplyFields: unknown = await searchReply.json();

    const isNotConversationHitsSearch = !hasConversationHits(searchReplyFields);
    if (isNotConversationHitsSearch) return [];

    await searchDialog.waitForReports(dialog, query);
    await searchDialog.resetScroll(dialog);
    return await searchDialog.collectReports(dialog, query, limit);
  } finally {
    await searchDialog.close();
  }
}

// ChatGPT search matches loosely, so only a chat whose title is exactly the query counts.
export async function searchChatGptConversationByTitle(
  page: Page,
  title: string,
): Promise<ConversationSearchReport | null> {
  const reports = await searchChatGptConversations(page, {
    query: title,
    limit: defaultSearchLimit,
  });
  return reports.find((report) => report.title.trim() === title.trim()) ?? null;
}
