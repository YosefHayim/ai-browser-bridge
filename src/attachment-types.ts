export type AttachmentRole = "assistant" | "user";

export type Attachment = {
  id: string;
  role: AttachmentRole;
  kind: "image" | "file" | "pdf";
  url: string;
  filename?: string;
  mime?: string;
  messageIndex: number;
  createdAt: string;
};

export type AttachmentManifest = {
  conversationId: string;
  // Mutable: providers push attachments as they are discovered.
  attachments: Attachment[];
  counters?: Record<AttachmentRole, Record<Attachment["kind"], number>>;
};
