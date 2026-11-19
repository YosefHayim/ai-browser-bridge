import { resolve } from "node:path";
import {
  readChatGptConversationIdFromUrl,
  readChatGptConversationUrlFromIdOrUrl,
} from "@/providers/chatgpt/backend-api/chatgpt-conversation-url.ts";

export const FILES_FLAG = "--files";

export function convertSecondsToTimeoutMilliseconds(
  seconds: number | undefined,
): number | undefined {
  const isSecondsUnset = seconds == null;
  if (isSecondsUnset) return undefined;

  const millisecondsPerSecond = 1000;

  return Math.round(seconds * millisecondsPerSecond);
}

export function readAbsolutePathFromOption(field: string | undefined): string | null {
  const isFieldFound = field != null && field !== "";
  return isFieldFound ? resolve(field) : null;
}

export function readConversationUrlFromOption(field: string): string {
  return readChatGptConversationUrlFromIdOrUrl(field);
}

export function readConversationIdFromOption(field: string): string {
  const conversationUrl = readConversationUrlFromOption(field);
  const conversationId = readChatGptConversationIdFromUrl(conversationUrl);

  const isNotChatUrl = conversationId == null;
  if (isNotChatUrl) throw new Error(`Not a ChatGPT chat id or URL: ${field}`);

  return conversationId;
}

export function parseAttachmentIds(fields: readonly string[] | undefined): string[] | null {
  const hasNoFields = !fields;
  if (hasNoFields) return null;

  const ids = fields
    .flatMap((field) => field.split(/[\s,]+/))
    .map((id) => id.trim())
    .filter(Boolean);
  const isIdsNotEmpty = ids.length > 0;
  return isIdsNotEmpty ? ids : null;
}
