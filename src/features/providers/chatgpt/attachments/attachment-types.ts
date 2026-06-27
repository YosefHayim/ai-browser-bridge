import type { Attachment, AttachmentRole } from "../../../domain/types.ts";

/** Minimal DOM snapshot used by the attachment walker. */
export type DomSnapshotNode =
  | { type: "text"; text: string }
  | {
    type: "element";
    tagName: string;
    attributes: Record<string, string>;
    children: DomSnapshotNode[];
  };

/** Attachment kind inferred from a DOM element. */
export type AttachmentKind = Attachment["kind"];

/** Per-role attachment id counters stored in the manifest. */
export type AttachmentCounters = Record<AttachmentRole, Record<AttachmentKind, number>>;

/** Legacy flat counter shape accepted when normalizing manifests. */
export type LegacyAttachmentCounters = Partial<Record<AttachmentKind, number>>;

/** Options for extracting all conversation messages with attachments. */
export type ExtractMessagesOptions = { conversationId: string; includeUserAttachments?: boolean };

/** Attachment record shape before role normalization. */
export type SerializedAttachment = Omit<Attachment, "role"> & { role?: AttachmentRole };

/** Candidate attachment discovered while walking a DOM snapshot. */
export interface AttachmentCandidate {
  kind: AttachmentKind;
  url: string;
  filename?: string;
  mime?: string;
}

/** Text and attachment candidates extracted from one message snapshot. */
export interface ExtractedContent {
  text: string;
  attachments: AttachmentCandidate[];
}

/** Serialized conversation message produced by the in-page snapshot script. */
export interface SerializedMessage {
  role: string;
  messageIndex: number;
  text: string;
  root: DomSnapshotNode;
}

/** Marker prefix used while walking snapshots before ids are assigned. */
export const MARKER_PREFIX = "\u0000attachment:";

/** Marker suffix used while walking snapshots before ids are assigned. */
export const MARKER_SUFFIX = "\u0000";
