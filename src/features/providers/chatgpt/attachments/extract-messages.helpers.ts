import type { AttachmentRole } from "../../../domain/types.ts";
import { assignAttachmentIds } from "./assign-attachments.ts";
import type { ExtractMessagesOptions, SerializedMessage } from "./attachment-types.ts";
import { countersFromManifest, loadManifest, saveManifest } from "./manifest-store.ts";
import { extractContentFromSnapshot } from "./snapshot-walk.ts";

export async function persistAllMessages(params: {
  messages: SerializedMessage[];
  opts: ExtractMessagesOptions;
}): Promise<Array<{ role: string; content: string; attachments: import("../../../domain/types.ts").Attachment[] }>> {
  const manifest = await loadManifest(params.opts.conversationId);
  const state = { manifest, counters: countersFromManifest(manifest), now: new Date().toISOString() };
  const captured = await mapCapturedMessages({ ...params, ...state });
  return saveCapturedMessages({ captured, manifest: state.manifest, counters: state.counters });
}

async function saveCapturedMessages(params: {
  captured: Array<{ role: string; content: string; attachments: import("../../../domain/types.ts").Attachment[] }>;
  manifest: Awaited<ReturnType<typeof loadManifest>>;
  counters: ReturnType<typeof countersFromManifest>;
}) {
  params.manifest.counters = params.counters;
  await saveManifest(params.manifest);
  return params.captured;
}

async function mapCapturedMessages(params: {
  messages: SerializedMessage[];
  opts: ExtractMessagesOptions;
  manifest: Awaited<ReturnType<typeof loadManifest>>;
  counters: ReturnType<typeof countersFromManifest>;
  now: string;
}) {
  const captured: Array<{ role: string; content: string; attachments: import("../../../domain/types.ts").Attachment[] }> = [];
  for (const message of params.messages) {
    captured.push(await captureMessage({ message, opts: params.opts, counters: params.counters, now: params.now, manifest: params.manifest }));
  }
  return captured;
}

async function captureMessage(params: {
  message: SerializedMessage;
  opts: ExtractMessagesOptions;
  counters: ReturnType<typeof countersFromManifest>;
  now: string;
  manifest: Awaited<ReturnType<typeof loadManifest>>;
}) {
  if (!shouldRegisterAttachments({ message: params.message, opts: params.opts })) {
    return { role: params.message.role, content: params.message.text, attachments: [] };
  }
  return registerMessageAttachments(params);
}

async function registerMessageAttachments(params: {
  message: SerializedMessage;
  counters: ReturnType<typeof countersFromManifest>;
  now: string;
  manifest: Awaited<ReturnType<typeof loadManifest>>;
}) {
  const role: AttachmentRole = params.message.role === "user" ? "user" : "assistant";
  const registered = assignAttachmentIds({
    extracted: extractContentFromSnapshot(params.message.root),
    role,
    messageIndex: params.message.messageIndex,
    counters: params.counters,
    createdAt: params.now,
    existing: params.manifest.attachments,
  });
  params.manifest.attachments.push(...registered.newAttachments);
  return { role: params.message.role, content: registered.text, attachments: registered.attachments };
}

function shouldRegisterAttachments(params: { message: SerializedMessage; opts: ExtractMessagesOptions }): boolean {
  if (params.message.role === "assistant") return true;
  return params.message.role === "user" && params.opts.includeUserAttachments === true;
}
