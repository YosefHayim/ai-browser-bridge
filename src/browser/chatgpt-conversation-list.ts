import type { BrowserContext, Response } from "playwright";
import type { Conversation } from "@/message-types.ts";

const CHATGPT_PROVIDER_ID = "chatgpt";

export function interceptChatGptConversationList(
  profile: BrowserContext,
  providerId: string,
  conversations: Conversation[],
): void {
  profile.on("response", (httpReply: Response) => {
    const isProviderIdNotChatgpt = providerId !== CHATGPT_PROVIDER_ID;
    if (isProviderIdNotChatgpt) return;

    void captureChatGptConversationList(httpReply, conversations);
  });
}

function readConversationSummaries(
  conversationListDocument: unknown,
): Record<string, unknown>[] | null {
  const isDocumentObjectMissing =
    typeof conversationListDocument !== "object" || conversationListDocument === null;
  if (isDocumentObjectMissing) return null;

  const isConversationListKeyMissing = !("items" in conversationListDocument);
  if (isConversationListKeyMissing) return null;

  const conversationSummaries = conversationListDocument.items;

  const isConversationArrayMissing = !Array.isArray(conversationSummaries);
  if (isConversationArrayMissing) return null;

  return conversationSummaries;
}

async function captureChatGptConversationList(
  httpReply: Response,
  conversations: Conversation[],
): Promise<void> {
  try {
    const url = httpReply.url();

    const isNotBackendApiConversationsInUrl = !url.includes("/backend-api/conversations?");
    if (isNotBackendApiConversationsInUrl) return;

    let conversationListDocument: unknown;
    try {
      conversationListDocument = await httpReply.json();
    } catch {
      return;
    }

    const conversationSummaries = readConversationSummaries(conversationListDocument);

    const isConversationSummariesMissing = conversationSummaries == null;
    if (isConversationSummariesMissing) return;

    conversations.splice(
      0,
      conversations.length,
      ...conversationSummaries.map((line: Record<string, unknown>) => {
        let title = "Untitled";

        const hasTitle = line.title != null;
        if (hasTitle) {
          title = String(line.title);
        }

        return {
          id: String(line.id),
          title,
          url: `https://chatgpt.com/c/${line.id}`,
        };
      }),
    );
  } catch {
    // Response body may already be consumed or non-JSON; list capture is best-effort.
    console.error("  Could not read the conversation list reply; skipped it.");
  }
}
