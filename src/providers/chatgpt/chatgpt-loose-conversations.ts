import type { Page } from "playwright";
import { readChatGptApi } from "./chatgpt-backend-api.ts";
import { readChatGptConversationUrlFromIdOrUrl } from "./chatgpt-conversation-url.ts";

const CONVERSATION_LIST_PAGE_SIZE = 100;
// Pause between list pages so a full-history scan stays under ChatGPT's rate limits.
const CONVERSATION_LIST_PAUSE_MS = 300;

export interface ConversationListElement {
  id: string;
  title: string | null;
  conversation_template_id?: string | null;
}

interface ConversationListReply {
  items: ConversationListElement[];
  total: number;
}

interface LooseConversation {
  id: string;
  title: string;
  url: string;
}

export const isProjectConversation = (element: ConversationListElement): boolean => {
  return element.conversation_template_id?.startsWith("g-p-") === true;
};

export const listLooseConversations = (
  elements: ConversationListElement[],
): LooseConversation[] => {
  const conversationsById = new Map<string, LooseConversation>();
  for (const element of elements) {
    const isProjectChat = isProjectConversation(element);
    if (isProjectChat) continue;

    const conversationUrl = readChatGptConversationUrlFromIdOrUrl(element.id);
    conversationsById.set(element.id, {
      id: element.id,
      title: element.title ?? "",
      url: conversationUrl,
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

export const readAllConversationElements = async (
  page: Page,
): Promise<ConversationListElement[]> => {
  const firstReply = await readConversationListPage(page, 0);
  const elements = [...firstReply.items];
  let total = firstReply.total;
  let isEveryElementRead = elements.length >= total;

  while (!isEveryElementRead) {
    await pauseBetweenListPages();
    const reply = await readConversationListPage(page, elements.length);

    const isPageEmpty = reply.items.length === 0;
    if (isPageEmpty) {
      throw new Error(
        `ChatGPT conversation list stopped at ${elements.length} of ${reply.total}. The inventory is incomplete.`,
      );
    }

    elements.push(...reply.items);
    total = reply.total;
    isEveryElementRead = elements.length >= total;
  }
  return elements;
};

export const readLooseConversations = async (page: Page): Promise<LooseConversation[]> => {
  const elements = await readAllConversationElements(page);
  return listLooseConversations(elements);
};
