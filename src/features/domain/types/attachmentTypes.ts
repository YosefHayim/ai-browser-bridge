/** Whether an attachment belongs to the user or assistant turn. */
export type AttachmentRole = "assistant" | "user";

/** Artifact discovered in a ChatGPT conversation. */
export interface Attachment {
  /** Stable placeholder id, e.g. "image-3" or "file-7". */
  id: string;
  /** Speaker role that owns the attachment. */
  role: AttachmentRole;
  /** Attachment category inferred from DOM metadata. */
  kind: "image" | "file" | "pdf";
  /** Source URL from src or href; may be blob: or https:. */
  url: string;
  /** Filename from download metadata or visible file pill text. */
  filename?: string;
  /** MIME type when known. */
  mime?: string;
  /** Zero-based message index for the attachment role. */
  messageIndex: number;
  /** ISO timestamp for when the attachment was registered. */
  createdAt: string;
}

/** Per-conversation registry of captured attachments. */
export interface AttachmentManifest {
  /** Provider conversation id. */
  conversationId: string;
  /** Attachments captured for the conversation. */
  attachments: Attachment[];
  /** Last assigned numeric suffix per role and attachment kind. */
  counters?: Record<AttachmentRole, Record<Attachment["kind"], number>>;
}
