import type { Attachment, AttachmentRole } from "../../../domain/types.ts";
import type { AttachmentCounters, AttachmentKind, ExtractedContent } from "./attachment-types.ts";

/** Resolve one attachment candidate to a stable id, reusing existing records when possible. */
export function resolveAttachment(ctx: {
  item: ExtractedContent["attachments"][number];
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
  const existing = findExistingAttachment(ctx);
  if (existing) return reuseExisting({ ctx, existing });
  return createAttachment(ctx);
}

function reuseExisting(params: { ctx: { usedExistingIds: Set<string> }; existing: Attachment }): Attachment {
  params.ctx.usedExistingIds.add(params.existing.id);
  return params.existing;
}

function createAttachment(ctx: {
  item: ExtractedContent["attachments"][number];
  params: {
    role: AttachmentRole;
    messageIndex: number;
    counters: AttachmentCounters;
    createdAt: string;
  };
  newAttachments: Attachment[];
}): Attachment {
  ctx.params.counters[ctx.params.role][ctx.item.kind] += 1;
  const attachment = buildAttachment(ctx);
  ctx.newAttachments.push(attachment);
  return attachment;
}

function findExistingAttachment(ctx: {
  item: ExtractedContent["attachments"][number];
  params: { role: AttachmentRole; messageIndex: number; existing: Attachment[] };
  usedExistingIds: Set<string>;
}): Attachment | undefined {
  return ctx.params.existing.find((attachment) =>
    !ctx.usedExistingIds.has(attachment.id)
    && attachment.role === ctx.params.role
    && attachment.messageIndex === ctx.params.messageIndex
    && attachment.kind === ctx.item.kind
    && attachment.url === ctx.item.url,
  );
}

function buildAttachment(ctx: {
  item: ExtractedContent["attachments"][number];
  params: { role: AttachmentRole; messageIndex: number; counters: AttachmentCounters; createdAt: string };
}): Attachment {
  const suffix = ctx.params.counters[ctx.params.role][ctx.item.kind];
  return {
    ...ctx.item,
    id: attachmentId({ role: ctx.params.role, kind: ctx.item.kind, suffix }),
    role: ctx.params.role,
    messageIndex: ctx.params.messageIndex,
    createdAt: ctx.params.createdAt,
  };
}

function attachmentId(params: { role: AttachmentRole; kind: AttachmentKind; suffix: number }): string {
  return params.role === "user" ? `user-${params.kind}-${params.suffix}` : `${params.kind}-${params.suffix}`;
}
