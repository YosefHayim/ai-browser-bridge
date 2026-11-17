import type { Page } from "playwright";
import type { Attachment, AttachmentRole } from "@/attachment-types.ts";
import {
  listAttachmentsFromImageRefs,
  listConversationImageRefs,
  readConversationReply,
} from "@/providers/chatgpt/backend-api/chatgpt-conversation-images.ts";
import {
  loadManifest,
  readCountersFromAttachments,
  readCountersFromManifest,
  saveManifest,
} from "@/providers/chatgpt/page/attachment-manifest.ts";
import {
  assignAttachmentIds,
  type ExtractMessagesSettings,
  registerExtractedMessage,
  type SerializedMessage,
} from "@/providers/chatgpt/page/attachment-registration.ts";
import {
  ASSISTANT_ROLE,
  IMAGE_KIND,
  USER_ROLE,
} from "@/providers/chatgpt/page/chatgpt-page-constants.ts";
import {
  ALL_MESSAGES_SNAPSHOT_ORIGIN,
  LAST_ASSISTANT_MESSAGE_SNAPSHOT_ORIGIN,
} from "@/providers/chatgpt/page/dom-snapshot-scripts.ts";
import { extractMessageFromSnapshot } from "@/providers/chatgpt/page/snapshot-attachments.ts";

async function persistAllMessages(parameters: {
  messages: SerializedMessage[];
  settings: ExtractMessagesSettings;
}): Promise<Array<{ role: string; content: string; attachments: Attachment[] }>> {
  const manifest = await loadManifest(parameters.settings.conversationId, {
    manifestRoot: parameters.settings.manifestRoot,
  });
  const status = {
    manifest,
    counters: readCountersFromManifest(manifest),
    now: new Date().toISOString(),
  };
  const captured = await listCapturedMessages({ ...parameters, ...status });

  return saveCapturedMessages({
    captured,
    manifest: status.manifest,
    counters: status.counters,
    manifestRoot: parameters.settings.manifestRoot,
  });
}

async function saveCapturedMessages(parameters: {
  captured: Array<{ role: string; content: string; attachments: Attachment[] }>;
  manifest: Awaited<ReturnType<typeof loadManifest>>;
  counters: ReturnType<typeof readCountersFromManifest>;
  manifestRoot?: string | undefined;
}) {
  parameters.manifest.counters = parameters.counters;
  await saveManifest(parameters.manifest, { manifestRoot: parameters.manifestRoot });
  return parameters.captured;
}

async function listCapturedMessages(parameters: {
  messages: SerializedMessage[];
  settings: ExtractMessagesSettings;
  manifest: Awaited<ReturnType<typeof loadManifest>>;
  counters: ReturnType<typeof readCountersFromManifest>;
  now: string;
}) {
  const captured: Array<{ role: string; content: string; attachments: Attachment[] }> = [];

  for (const message of parameters.messages) {
    const capturedMessage = await captureMessage({
      message,
      settings: parameters.settings,
      counters: parameters.counters,
      now: parameters.now,
      manifest: parameters.manifest,
    });
    captured.push(capturedMessage);
  }

  return captured;
}

async function captureMessage(parameters: {
  message: SerializedMessage;
  settings: ExtractMessagesSettings;
  counters: ReturnType<typeof readCountersFromManifest>;
  now: string;
  manifest: Awaited<ReturnType<typeof loadManifest>>;
}) {
  const isAttachmentRegistrationOff = !isAttachmentRegistrationWanted({
    message: parameters.message,
    settings: parameters.settings,
  });
  if (isAttachmentRegistrationOff) {
    return { role: parameters.message.role, content: parameters.message.text, attachments: [] };
  }

  return registerMessageAttachments(parameters);
}

async function registerMessageAttachments(parameters: {
  message: SerializedMessage;
  counters: ReturnType<typeof readCountersFromManifest>;
  now: string;
  manifest: Awaited<ReturnType<typeof loadManifest>>;
}) {
  const isUserRole = parameters.message.role === USER_ROLE;
  const role: AttachmentRole = isUserRole ? USER_ROLE : ASSISTANT_ROLE;
  const extractedSnapshotMessage = extractMessageFromSnapshot(parameters.message.root);
  const registered = assignAttachmentIds({
    extracted: extractedSnapshotMessage,
    role,
    messageIndex: parameters.message.messageIndex,
    counters: parameters.counters,
    createdAt: parameters.now,
    existing: parameters.manifest.attachments,
  });

  parameters.manifest.attachments.push(...registered.newAttachments);

  return {
    role: parameters.message.role,
    content: registered.text,
    attachments: registered.attachments,
  };
}

function isAttachmentRegistrationWanted(parameters: {
  message: SerializedMessage;
  settings: ExtractMessagesSettings;
}): boolean {
  const isMessageRoleAssistant = parameters.message.role === ASSISTANT_ROLE;
  if (isMessageRoleAssistant) return true;

  return (
    parameters.message.role === USER_ROLE && parameters.settings.includeUserAttachments === true
  );
}

export async function extractAssistantMessage(
  page: Page,
  settings: { conversationId: string; manifestRoot?: string | undefined },
): Promise<{ text: string; attachments: Attachment[] }> {
  const message = await page.evaluate<SerializedMessage | null>(
    LAST_ASSISTANT_MESSAGE_SNAPSHOT_ORIGIN,
  );

  const isMessageEmpty = !message;
  if (isMessageEmpty) return { text: "", attachments: [] };

  const extractedRootMessage = extractMessageFromSnapshot(message.root);
  return registerExtractedMessage({
    conversationId: settings.conversationId,
    messageIndex: message.messageIndex,
    extracted: extractedRootMessage,
    manifestRoot: settings.manifestRoot,
  });
}

export async function registerConversationImages(parameters: {
  page: Page;
  conversationId: string;
  manifestRoot?: string | undefined;
}): Promise<void> {
  const conversation = await readConversationReply(parameters.page, parameters.conversationId);
  const imageRefs = listConversationImageRefs(conversation);
  const manifest = await loadManifest(parameters.conversationId, {
    manifestRoot: parameters.manifestRoot,
  });
  const otherAttachments = manifest.attachments.filter(
    (attachment) => attachment.kind !== IMAGE_KIND,
  );
  const nowIso = new Date().toISOString();
  const imageAttachments = listAttachmentsFromImageRefs({
    refs: imageRefs,
    createdAt: nowIso,
  });

  manifest.attachments = [...otherAttachments, ...imageAttachments];
  manifest.counters = readCountersFromAttachments(manifest.attachments);
  await saveManifest(manifest, { manifestRoot: parameters.manifestRoot });
}

export async function extractAllMessages(
  page: Page,
  settings: ExtractMessagesSettings,
): Promise<Array<{ role: string; content: string; attachments: Attachment[] }>> {
  const messages = await page.evaluate<SerializedMessage[]>(ALL_MESSAGES_SNAPSHOT_ORIGIN);
  return persistAllMessages({ messages, settings });
}
