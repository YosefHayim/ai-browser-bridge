export type AttachmentRole = "assistant" | "user";

export type Attachment = {
  // Placeholder form used in message text, e.g. "image-3" or "file-7".
  id: string;
  role: AttachmentRole;
  kind: "image" | "file" | "pdf";
  // From img src or anchor href; may be blob: or https:.
  url: string;
  filename?: string;
  mime?: string;
  // Zero-based index among messages of this attachment role.
  messageIndex: number;
  createdAt: string;
};

export type AttachmentManifest = {
  conversationId: string;
  // Mutable: providers push attachments as they are discovered.
  attachments: Attachment[];
  counters?: Record<AttachmentRole, Record<Attachment["kind"], number>>;
};
