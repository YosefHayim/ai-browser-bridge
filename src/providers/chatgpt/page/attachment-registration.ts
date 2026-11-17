import type { Attachment, AttachmentRole } from "@/attachment-types.ts";
import {
  loadManifest,
  readCountersFromManifest,
  saveManifest,
} from "@/providers/chatgpt/page/attachment-manifest.ts";
import {
  ASSISTANT_ROLE,
  BLOB_URL_PREFIX,
  USER_ROLE,
} from "@/providers/chatgpt/page/chatgpt-page-constants.ts";

function readRegisteredAttachment(details: {
  item: ExtractedMessage["attachments"][number];
  params: {
    role: AttachmentRole;
    messageIndex: number;
    counters: AttachmentCounters;
    createdAt: string;
    existing: Attachment[];
  };
  usedExistingIds: Set<string>;
  newAttachments: Attachment[];
}): Attachment {
  const existing = findExistingAttachment(details);

  const isExistingFound = existing != null;
  if (isExistingFound) return reuseExisting({ details: details, existing });

  return createAttachment(details);
}

function reuseExisting(parameters: {
  details: { item: ExtractedMessage["attachments"][number]; usedExistingIds: Set<string> };
  existing: Attachment;
}): Attachment {
  parameters.details.usedExistingIds.add(parameters.existing.id);
  parameters.existing.url = parameters.details.item.url;
  return parameters.existing;
}

function createAttachment(details: {
  item: ExtractedMessage["attachments"][number];
  params: {
    role: AttachmentRole;
    messageIndex: number;
    counters: AttachmentCounters;
    createdAt: string;
  };
  newAttachments: Attachment[];
}): Attachment {
  details.params.counters[details.params.role][details.item.kind] += 1;
  const attachment = readNewAttachment(details);
  details.newAttachments.push(attachment);
  return attachment;
}

function findExistingAttachment(details: {
  item: ExtractedMessage["attachments"][number];
  params: { role: AttachmentRole; messageIndex: number; existing: Attachment[] };
  usedExistingIds: Set<string>;
}): Attachment | null {
  return (
    details.params.existing.find(
      (attachment) =>
        !details.usedExistingIds.has(attachment.id) &&
        attachment.role === details.params.role &&
        attachment.messageIndex === details.params.messageIndex &&
        attachment.kind === details.item.kind &&
        isSameAttachmentOrigin({ attachment, item: details.item }),
    ) ?? null
  );
}

function isSameAttachmentOrigin(details: {
  attachment: Attachment;
  item: ExtractedMessage["attachments"][number];
}): boolean {
  const hasSameUrl = details.attachment.url === details.item.url;
  const isReloadedPageBlob =
    details.attachment.url.startsWith(BLOB_URL_PREFIX) &&
    details.item.url.startsWith(BLOB_URL_PREFIX);
  const hasSameFilename = details.attachment.filename === details.item.filename;

  return hasSameUrl || (isReloadedPageBlob && hasSameFilename);
}

function readNewAttachment(details: {
  item: ExtractedMessage["attachments"][number];
  params: {
    role: AttachmentRole;
    messageIndex: number;
    counters: AttachmentCounters;
    createdAt: string;
  };
}): Attachment {
  const suffix = details.params.counters[details.params.role][details.item.kind];

  return {
    ...details.item,
    id: readAttachmentId({ role: details.params.role, kind: details.item.kind, suffix }),
    role: details.params.role,
    messageIndex: details.params.messageIndex,
    createdAt: details.params.createdAt,
  };
}

function readAttachmentId(parameters: {
  role: AttachmentRole;
  kind: AttachmentKind;
  suffix: number;
}): string {
  const isUserRole = parameters.role === USER_ROLE;

  return isUserRole
    ? `user-${parameters.kind}-${parameters.suffix}`
    : `${parameters.kind}-${parameters.suffix}`;
}

export async function registerExtractedMessage(parameters: {
  conversationId: string;
  messageIndex: number;
  extracted: ExtractedMessage;
  manifestRoot?: string | undefined;
}): Promise<{ text: string; attachments: Attachment[] }> {
  const manifest = await loadManifest(parameters.conversationId, {
    manifestRoot: parameters.manifestRoot,
  });
  const manifestCounters = readCountersFromManifest(manifest);
  const nowIso = new Date().toISOString();
  const registered = assignAttachmentIds({
    extracted: parameters.extracted,
    role: ASSISTANT_ROLE,
    messageIndex: parameters.messageIndex,
    counters: manifestCounters,
    createdAt: nowIso,
    existing: manifest.attachments,
  });

  return finalizeRegistration({ manifest, registered, manifestRoot: parameters.manifestRoot });
}

export function assignAttachmentIds(parameters: {
  extracted: ExtractedMessage;
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
  const attachments = parameters.extracted.attachments.map((element) =>
    readRegisteredAttachment({
      item: element,
      params: parameters,
      usedExistingIds,
      newAttachments,
    }),
  );

  return {
    text: replaceMarkers({ text: parameters.extracted.text, attachments }),
    attachments,
    newAttachments,
    counters: parameters.counters,
  };
}

async function finalizeRegistration(parameters: {
  manifest: Awaited<ReturnType<typeof loadManifest>>;
  registered: ReturnType<typeof assignAttachmentIds>;
  manifestRoot?: string | undefined;
}): Promise<{ text: string; attachments: Attachment[] }> {
  parameters.manifest.attachments.push(...parameters.registered.newAttachments);
  parameters.manifest.counters = parameters.registered.counters;
  await saveManifest(parameters.manifest, { manifestRoot: parameters.manifestRoot });
  return { text: parameters.registered.text, attachments: parameters.registered.attachments };
}

function replaceMarkers(parameters: { text: string; attachments: Attachment[] }): string {
  let message = parameters.text;

  for (let index = 0; index < parameters.attachments.length; index += 1) {
    const attachmentId = parameters.attachments[index]?.id;
    const isAttachmentIdMissing = attachmentId == null;
    const markerId = isAttachmentIdMissing ? "" : attachmentId;
    const markerPlaceholder = createMarker(index);
    message = message.replace(markerPlaceholder, `[${markerId}]`);
  }

  return message;
}

export function createMarker(index: number): string {
  return `${"\u0000attachment:"}${index}${"\u0000"}`;
}

export type DomSnapshotNode =
  | { type: "text"; text: string }
  | {
      type: "element";
      tagName: string;
      attributes: Record<string, string>;
      children: DomSnapshotNode[];
    };

export type AttachmentKind = Attachment["kind"];

export type AttachmentCounters = Record<AttachmentRole, Record<AttachmentKind, number>>;

export type ExtractMessagesSettings = {
  conversationId: string;
  includeUserAttachments?: boolean;
  manifestRoot?: string | undefined;
};

export type SerializedAttachment = Omit<Attachment, "role"> & { role?: AttachmentRole };

export type ManifestStoreSettings = {
  manifestRoot?: string | undefined;
};

export type AttachmentCandidate = {
  kind: AttachmentKind;
  url: string;
  filename?: string;
  mime?: string;
};

export type ExtractedMessage = {
  text: string;
  attachments: AttachmentCandidate[];
};

export type SerializedMessage = {
  role: string;
  messageIndex: number;
  text: string;
  root: DomSnapshotNode;
};
