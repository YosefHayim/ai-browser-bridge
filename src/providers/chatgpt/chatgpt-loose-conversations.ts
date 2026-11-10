import type { Page } from "playwright";
import { readChatGptApi } from "./chatgpt-backend-api.ts";
import { readChatGptConversationUrlFromIdOrUrl } from "./chatgpt-conversation-url.ts";

// Conversations inside a ChatGPT Project have a template id that starts with this prefix.
const PROJECT_TEMPLATE_ID_PREFIX = "g-p-";
const CONVERSATION_LIST_PAGE_SIZE = 100;
// Pause between list pages so a full-history scan stays under ChatGPT's rate limits.
const CONVERSATION_LIST_PAUSE_MS = 300;

export interface ConversationListItem {
  id: string;
  title: string | null;
  conversation_template_id?: string | null;
}

interface ConversationListReply {
  items: ConversationListItem[];
  total: number;
}

interface LooseConversation {
  id: string;
  title: string;
  url: string;
}

export const isProjectConversation = (item: ConversationListItem): boolean => {
  return item.conversation_template_id?.startsWith(PROJECT_TEMPLATE_ID_PREFIX) === true;
};

export const listLooseConversationsFrom = (items: ConversationListItem[]): LooseConversation[] => {
  const conversationsById = new Map<string, LooseConversation>();
  for (const item of items) {
    const isProjectChat = isProjectConversation(item);
    if (isProjectChat) continue;

    conversationsById.set(item.id, {
      id: item.id,
      title: item.title ?? "",
      url: readChatGptConversationUrlFromIdOrUrl(item.id),
    });
  }
  return [...conversationsById.values()];
};

const readConversationListPage = (page: Page, offset: number): Promise<ConversationListReply> => {
  const listPath = `/backend-api/conversations?offset=${offset}&limit=${CONVERSATION_LIST_PAGE_SIZE}&order=updated`;
  return readChatGptApi<ConversationListReply>(page, listPath);
};

const pauseBetweenListPages = (): Promise<void> => {
  return new Promise((wakeUp) => setTimeout(wakeUp, CONVERSATION_LIST_PAUSE_MS));
};

export const readAllConversationItems = async (page: Page): Promise<ConversationListItem[]> => {
  const firstReply = await readConversationListPage(page, 0);
  const items = [...firstReply.items];
  let total = firstReply.total;
  let isEveryItemRead = items.length >= total;

  while (!isEveryItemRead) {
    await pauseBetweenListPages();
    const reply = await readConversationListPage(page, items.length);

    const isPageEmpty = reply.items.length === 0;
    if (isPageEmpty) {
      throw new Error(
        `ChatGPT conversation list stopped at ${items.length} of ${reply.total}. The inventory is incomplete.`,
      );
    }

    items.push(...reply.items);
    total = reply.total;
    isEveryItemRead = items.length >= total;
  }
  return items;
};

export const readLooseConversations = async (page: Page): Promise<LooseConversation[]> => {
  const items = await readAllConversationItems(page);
  return listLooseConversationsFrom(items);
};
