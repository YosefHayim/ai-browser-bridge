import type { Attachment, AttachmentRole } from "../../../domain/types.ts";
import type { AttachmentCounters, AttachmentKind, ExtractedContent } from "./attachment-types.ts";
import { MARKER_PREFIX, MARKER_SUFFIX } from "./attachment-types.ts";
import { countersFromManifest, loadManifest, saveManifest } from "./manifest-store.ts";
import { resolveAttachment } from "./assign-attachments-resolve.ts";

/** Register extracted assistant content and persist new attachment ids. */
export async function registerExtractedContent(params: {
  conversationId: string;
  messageIndex: number;
  extracted: ExtractedContent;
}): Promise<{ text: string; attachments: Attachment[] }> {
  const manifest = await loadManifest(params.conversationId);
  const registered = assignAttachmentIds({
    extracted: params.extracted,
    role: "assistant",
    messageIndex: params.messageIndex,
    counters: countersFromManifest(manifest),
    createdAt: new Date().toISOString(),
    existing: manifest.attachments,
  });
  return finalizeRegistration({ manifest, registered });
}

/** Assign stable attachment ids and replace temporary markers in text. */
export function assignAttachmentIds(params: {
  extracted: ExtractedContent;
  role: AttachmentRole;
  messageIndex: number;
  counters: AttachmentCounters;
  createdAt: string;
  existing: Attachment[];
}): {
  text: string;
  attachments: Attachment[];
  newAttachments: Attachment[];
  counters: AttachmentCounters;
} {
  const usedExistingIds = new Set<string>();
  const newAttachments: Attachment[] = [];
  const attachments = params.extracted.attachments.map((item) =>
    resolveAttachment({ item, params, usedExistingIds, newAttachments }),
  );
  return {
    text: replaceMarkers({ text: params.extracted.text, attachments }),
    attachments,
    newAttachments,
    counters: params.counters,
  };
}

async function finalizeRegistration(params: {
  manifest: Awaited<ReturnType<typeof loadManifest>>;
  registered: ReturnType<typeof assignAttachmentIds>;
}): Promise<{ text: string; attachments: Attachment[] }> {
  params.manifest.attachments.push(...params.registered.newAttachments);
  params.manifest.counters = params.registered.counters;
  await saveManifest(params.manifest);
  return { text: params.registered.text, attachments: params.registered.attachments };
}

function replaceMarkers(params: { text: string; attachments: Attachment[] }): string {
  let content = params.text;
  for (let index = 0; index < params.attachments.length; index += 1) {
    content = content.replace(markerFor(index), `[${params.attachments[index]?.id ?? ""}]`);
  }
  return content;
}

function markerFor(index: number): string {
  return `${MARKER_PREFIX}${index}${MARKER_SUFFIX}`;
}
