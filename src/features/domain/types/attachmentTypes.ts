export type AttachmentRole = "assistant" | "user";

/** Artifact discovered in a ChatGPT conversation. */
export type Attachment = {
  /** Stable placeholder id, e.g. "image-3" or "file-7". */
  id: string;
  role: AttachmentRole;
  kind: "image" | "file" | "pdf";
  /** Source URL from src or href; may be blob: or https:. */
  url: string;
  filename?: string;
  mime?: string;
  /** Zero-based message index for the attachment role. */
  messageIndex: number;
  createdAt: string;
};

/** Per-conversation registry of captured attachments. */
export type AttachmentManifest = {
  conversationId: string;
  /** Mutable: providers push attachments as they are discovered. */
  attachments: Attachment[];
  counters?: Record<AttachmentRole, Record<Attachment["kind"], number>>;
};
