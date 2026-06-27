import type { Page } from "playwright";
import type { Attachment } from "../../../domain/types.ts";
import { registerExtractedContent } from "./assign-attachments.ts";
import type { DomSnapshotNode, ExtractMessagesOptions, SerializedMessage } from "./attachment-types.ts";
import {
  ALL_MESSAGES_SNAPSHOT_SOURCE,
  LAST_ASSISTANT_MESSAGE_SNAPSHOT_SOURCE,
} from "./dom-snapshot.dom-snippet.ts";
import { persistAllMessages } from "./extract-messages.helpers.ts";
import { extractContentFromSnapshot } from "./snapshot-walk.ts";

export type { DomSnapshotNode } from "./attachment-types.ts";
export { extractContentFromSnapshot } from "./snapshot-walk.ts";
export { loadManifest, saveManifest, appendAttachments } from "./manifest-store.ts";

/** Extract text and assistant attachments from the last assistant message. */
export async function extractAssistantContent(
  page: Page,
  opts: { conversationId: string },
): Promise<{ text: string; attachments: Attachment[] }> {
  const message = await page.evaluate<SerializedMessage | null>(LAST_ASSISTANT_MESSAGE_SNAPSHOT_SOURCE);
  if (!message) return { text: "", attachments: [] };
  return registerExtractedContent({
    conversationId: opts.conversationId,
    messageIndex: message.messageIndex,
    extracted: extractContentFromSnapshot(message.root),
  });
}

/** Extract all rendered messages while registering assistant attachments and, optionally, user attachments. */
export async function extractAllMessages(
  page: Page,
  opts: ExtractMessagesOptions,
): Promise<Array<{ role: string; content: string; attachments: Attachment[] }>> {
  const messages = await page.evaluate<SerializedMessage[]>(ALL_MESSAGES_SNAPSHOT_SOURCE);
  return persistAllMessages({ messages, opts });
}
