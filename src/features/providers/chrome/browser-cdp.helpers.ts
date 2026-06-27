import type { Response } from "playwright";
import type { Conversation } from "../../domain/types.ts";

interface InterceptInput {
  context: import("playwright").BrowserContext;
  providerId: string;
  conversations: Conversation[];
}

/** Attach response listeners for provider-specific APIs. */
export function interceptResponses(input: InterceptInput): void {
  input.context.on("response", (response: Response) => {
    if (input.providerId !== "chatgpt") return;
    void parseChatGptConversations({ response, conversations: input.conversations }).catch(() => {});
  });
}

interface ParseConversationsInput {
  response: Response;
  conversations: Conversation[];
}

async function parseChatGptConversations(input: ParseConversationsInput): Promise<void> {
  const url = input.response.url();
  if (!url.includes("/backend-api/conversations?")) return;
  const items = await readConversationItems(input.response);
  if (!items) return;
  input.conversations.splice(0, input.conversations.length, ...items.map(mapConversationItem));
}

async function readConversationItems(response: Response): Promise<Record<string, unknown>[] | null> {
  const body = await response.json().catch(() => null);
  const items = body?.items;
  return Array.isArray(items) ? items as Record<string, unknown>[] : null;
}

function mapConversationItem(item: Record<string, unknown>): Conversation {
  return {
    id: String(item.id),
    title: String(item.title ?? "Untitled"),
    url: `https://chatgpt.com/c/${item.id}`,
  };
}

export type { CdpConnectState } from "./browser-cdp.connect.ts";
export { tryConnectOverCdp, findProviderPage, navigateIfNeeded } from "./browser-cdp.connect.ts";
