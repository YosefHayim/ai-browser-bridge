import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import { isNodeError } from "../core/errors.ts";
import type { Attachment, AttachmentManifest, AttachmentRole } from "../types/types.ts";

const MARKER_PREFIX = "\u0000attachment:";
const MARKER_SUFFIX = "\u0000";

type AttachmentKind = Attachment["kind"];
type AttachmentCounters = Record<AttachmentRole, Record<AttachmentKind, number>>;
type LegacyAttachmentCounters = Partial<Record<AttachmentKind, number>>;
type ExtractMessagesOptions = { conversationId: string; includeUserAttachments?: boolean };
type SerializedAttachment = Omit<Attachment, "role"> & { role?: AttachmentRole };

interface AttachmentCandidate {
  kind: AttachmentKind;
  url: string;
  filename?: string;
  mime?: string;
}

interface ExtractedContent {
  text: string;
  attachments: AttachmentCandidate[];
}

interface SerializedMessage {
  role: string;
  messageIndex: number;
  text: string;
  root: DomSnapshotNode;
}

const DOM_SNAPSHOT_HELPERS_SOURCE = String.raw`
const GENERATED_IMAGE_SELECTOR = 'img[src*="/backend-api/estuary/content"], img[alt^="Generated image"]';

function serializeMessage(element, messageIndex) {
  return {
    role: element.getAttribute("data-message-author-role") ?? "unknown",
    messageIndex,
    text: element instanceof HTMLElement ? element.innerText : element.textContent ?? "",
    root: snapshotNode(element),
  };
}

// Serialize one conversation turn. Resolves role from an inner role block when present;
// otherwise a turn that only holds a generated image is treated as an assistant message.
// Generated images that render outside the role block (but inside the turn) are appended
// as extra children so the walker still visits them.
function serializeTurn(turn, messageIndex) {
  const roleBlock = turn.querySelector("[data-message-author-role]");
  const generatedImages = Array.from(turn.querySelectorAll(GENERATED_IMAGE_SELECTOR));

  if (!roleBlock) {
    if (generatedImages.length === 0) return null;
    return {
      role: "assistant",
      messageIndex,
      text: turn instanceof HTMLElement ? turn.innerText : turn.textContent ?? "",
      root: { type: "element", tagName: "div", attributes: {}, children: generatedImages.map(snapshotNode) },
    };
  }

  const message = serializeMessage(roleBlock, messageIndex);
  const outsideBlock = generatedImages.filter((image) => !roleBlock.contains(image));
  if (outsideBlock.length > 0) {
    message.root.children.push(...outsideBlock.map(snapshotNode));
  }
  return message;
}

function turnRole(turn) {
  const roleBlock = turn.querySelector("[data-message-author-role]");
  if (roleBlock) return roleBlock.getAttribute("data-message-author-role") ?? "unknown";
  if (turn.querySelector(GENERATED_IMAGE_SELECTOR)) return "assistant";
  return null;
}

function snapshotNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return { type: "text", text: node.textContent ?? "" };
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return { type: "text", text: "" };
  }

  const element = node;
  const attributes = {};
  for (const attribute of Array.from(element.attributes)) {
    attributes[attribute.name] = attribute.value;
  }
  if (element instanceof HTMLImageElement && element.currentSrc) {
    attributes.currentSrc = element.currentSrc;
  }

  return {
    type: "element",
    tagName: element.tagName.toLowerCase(),
    attributes,
    children: Array.from(element.childNodes).map(snapshotNode),
  };
}
`;

const LAST_ASSISTANT_MESSAGE_SNAPSHOT_SOURCE = String.raw`
(() => {
  ${DOM_SNAPSHOT_HELPERS_SOURCE}

  const turns = Array.from(document.querySelectorAll('section[data-testid^="conversation-turn-"]'));
  let assistantIndex = -1;
  let lastAssistant = null;
  for (const turn of turns) {
    if (turnRole(turn) === "assistant") {
      assistantIndex += 1;
      lastAssistant = serializeTurn(turn, assistantIndex);
    }
  }
  return lastAssistant;
})()
`;

const ALL_MESSAGES_SNAPSHOT_SOURCE = String.raw`
(() => {
  ${DOM_SNAPSHOT_HELPERS_SOURCE}

  let assistantIndex = -1;
  let userIndex = -1;
  const messages = [];
  for (const turn of Array.from(document.querySelectorAll('section[data-testid^="conversation-turn-"]'))) {
    const role = turnRole(turn);
    if (role === null) continue;
    if (role === "assistant") assistantIndex += 1;
    if (role === "user") userIndex += 1;
    const message = serializeTurn(turn, role === "assistant" ? assistantIndex : role === "user" ? userIndex : -1);
    if (message) messages.push(message);
  }
  return messages;
})()
`;

/** Minimal DOM snapshot used by the attachment walker. */
export type DomSnapshotNode =
  | { type: "text"; text: string }
  | {
    type: "element";
    tagName: string;
    attributes: Record<string, string>;
    children: DomSnapshotNode[];
  };

/** Extract text and assistant attachments from the last assistant message. */
export async function extractAssistantContent(
  page: Page,
  opts: { conversationId: string },
): Promise<{ text: string; attachments: Attachment[] }> {
  const message = await page.evaluate<SerializedMessage | null>(LAST_ASSISTANT_MESSAGE_SNAPSHOT_SOURCE);
  if (!message) return { text: "", attachments: [] };

  return registerExtractedContent(opts.conversationId, message.messageIndex, extractContentFromSnapshot(message.root));
}

/** Extract all rendered messages while registering assistant attachments and, optionally, user attachments. */
export async function extractAllMessages(
  page: Page,
  opts: ExtractMessagesOptions,
): Promise<Array<{ role: string; content: string; attachments: Attachment[] }>> {
  const messages = await page.evaluate<SerializedMessage[]>(ALL_MESSAGES_SNAPSHOT_SOURCE);
  const manifest = await loadManifest(opts.conversationId);
  const counters = countersFromManifest(manifest);
  const now = new Date().toISOString();
  const captured: Array<{ role: string; content: string; attachments: Attachment[] }> = [];

  for (const message of messages) {
    if (message.role !== "assistant" && (message.role !== "user" || opts.includeUserAttachments !== true)) {
      captured.push({ role: message.role, content: message.text, attachments: [] });
      continue;
    }

    const role: AttachmentRole = message.role === "user" ? "user" : "assistant";
    const extracted = extractContentFromSnapshot(message.root);
    const registered = assignAttachmentIds(extracted, role, message.messageIndex, counters, now, manifest.attachments);
    manifest.attachments.push(...registered.newAttachments);
    captured.push({ role: message.role, content: registered.text, attachments: registered.attachments });
  }

  manifest.counters = counters;
  await saveManifest(manifest);
  return captured;
}

/** Load a conversation attachment manifest, creating an empty one if needed. */
export async function loadManifest(conversationId: string): Promise<AttachmentManifest> {
  try {
    const raw = await readFile(manifestPath(conversationId), "utf8");
    return normalizeManifest(conversationId, JSON.parse(raw) as Partial<AttachmentManifest>);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { conversationId, attachments: [], counters: emptyCounters() };
    }
    throw error;
  }
}

/** Persist a conversation attachment manifest. */
export async function saveManifest(manifest: AttachmentManifest): Promise<void> {
  const normalized = normalizeManifest(manifest.conversationId, manifest);
  const filePath = manifestPath(normalized.conversationId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

/** Append already registered attachments to a conversation manifest. */
export async function appendAttachments(conversationId: string, items: Attachment[]): Promise<AttachmentManifest> {
  const manifest = await loadManifest(conversationId);
  manifest.attachments.push(...items);
  manifest.counters = countersFromManifest(manifest);
  await saveManifest(manifest);
  return manifest;
}

/** Convert a DOM snapshot into text with temporary attachment markers. */
export function extractContentFromSnapshot(root: DomSnapshotNode): ExtractedContent {
  const attachments: AttachmentCandidate[] = [];
  const text = walkSnapshot(root, attachments);
  return { text, attachments };
}

async function registerExtractedContent(
  conversationId: string,
  messageIndex: number,
  extracted: ExtractedContent,
): Promise<{ text: string; attachments: Attachment[] }> {
  const manifest = await loadManifest(conversationId);
  const counters = countersFromManifest(manifest);
  const registered = assignAttachmentIds(
    extracted,
    "assistant",
    messageIndex,
    counters,
    new Date().toISOString(),
    manifest.attachments,
  );
  manifest.attachments.push(...registered.newAttachments);
  manifest.counters = counters;
  await saveManifest(manifest);
  return registered;
}

function assignAttachmentIds(
  extracted: ExtractedContent,
  role: AttachmentRole,
  messageIndex: number,
  counters: AttachmentCounters,
  createdAt: string,
  existing: Attachment[],
): { text: string; attachments: Attachment[]; newAttachments: Attachment[] } {
  const usedExistingIds = new Set<string>();
  const newAttachments: Attachment[] = [];
  const attachments = extracted.attachments.map((item) => {
    const existingAttachment = existing.find((attachment) =>
      !usedExistingIds.has(attachment.id)
      && attachment.role === role
      && attachment.messageIndex === messageIndex
      && attachment.kind === item.kind
      && attachment.url === item.url,
    );
    if (existingAttachment) {
      usedExistingIds.add(existingAttachment.id);
      return existingAttachment;
    }

    counters[role][item.kind] += 1;
    const attachment = {
      ...item,
      id: attachmentId(role, item.kind, counters[role][item.kind]),
      role,
      messageIndex,
      createdAt,
    };
    newAttachments.push(attachment);
    return attachment;
  });

  return {
    text: attachments.reduce(
      (content, attachment, index) => content.replace(markerFor(index), `[${attachment.id}]`),
      extracted.text,
    ),
    attachments,
    newAttachments,
  };
}

function attachmentId(role: AttachmentRole, kind: AttachmentKind, suffix: number): string {
  return role === "user" ? `user-${kind}-${suffix}` : `${kind}-${suffix}`;
}

function walkSnapshot(node: DomSnapshotNode, attachments: AttachmentCandidate[]): string {
  if (node.type === "text") return node.text;

  const attachment = attachmentFromElement(node);
  if (attachment) {
    const marker = markerFor(attachments.length);
    attachments.push(attachment);
    return marker;
  }

  if (node.tagName === "br") return "\n";
  return node.children.map((child) => walkSnapshot(child, attachments)).join("");
}

function attachmentFromElement(node: Extract<DomSnapshotNode, { type: "element" }>): AttachmentCandidate | null {
  if (node.tagName === "img") {
    const url = attr(node, "currentSrc") || attr(node, "src");
    if (!url) return null;
    return {
      kind: "image",
      url,
      filename: optionalText(attr(node, "alt")),
      mime: inferMime(url, "image"),
    };
  }

  if (node.tagName === "iframe") {
    const url = attr(node, "src");
    if (!url) return null;
    return {
      kind: "pdf",
      url,
      filename: optionalText(attr(node, "title") || attr(node, "aria-label")),
      mime: "application/pdf",
    };
  }

  if (node.tagName === "a" && isFileLink(node)) {
    const url = attr(node, "href");
    if (!url) return null;
    const filename = optionalText(attr(node, "download")) ?? optionalText(textOnly(node));
    return {
      kind: "file",
      url,
      filename,
      mime: inferMime(url, "file"),
    };
  }

  return null;
}

function isFileLink(node: Extract<DomSnapshotNode, { type: "element" }>): boolean {
  const download = attr(node, "download");
  if (download !== undefined) return true;

  const href = attr(node, "href") ?? "";
  const label = `${attr(node, "aria-label") ?? ""} ${attr(node, "data-testid") ?? ""}`.toLowerCase();
  return href.startsWith("blob:") || label.includes("download") || label.includes("file");
}

function textOnly(node: DomSnapshotNode): string {
  if (node.type === "text") return node.text;
  return node.children.map(textOnly).join("");
}

function attr(node: Extract<DomSnapshotNode, { type: "element" }>, name: string): string | undefined {
  return node.attributes[name];
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function inferMime(url: string, fallback: AttachmentKind): string | undefined {
  const dataMatch = /^data:([^;,]+)/.exec(url);
  if (dataMatch) return dataMatch[1];

  const lower = url.split("?")[0]?.toLowerCase() ?? "";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (fallback === "image") return "image/*";
  return undefined;
}

function markerFor(index: number): string {
  return `${MARKER_PREFIX}${index}${MARKER_SUFFIX}`;
}

function manifestPath(conversationId: string): string {
  const downloadsRoot = path.resolve(process.cwd(), "downloads");
  const filePath = path.resolve(downloadsRoot, conversationId, "manifest.json");
  if (!filePath.startsWith(`${downloadsRoot}${path.sep}`)) {
    throw new Error(`Invalid conversation id for attachment manifest: ${conversationId}`);
  }
  return filePath;
}

function normalizeManifest(conversationId: string, manifest: Partial<AttachmentManifest>): AttachmentManifest {
  const attachments = Array.isArray(manifest.attachments)
    ? manifest.attachments.map(normalizeAttachment)
    : [];
  return {
    conversationId: manifest.conversationId ?? conversationId,
    attachments,
    counters: mergeCounters(countersFromAttachments(attachments), manifest.counters),
  };
}

function countersFromManifest(manifest: AttachmentManifest): AttachmentCounters {
  return mergeCounters(countersFromAttachments(manifest.attachments), manifest.counters);
}

function normalizeAttachment(attachment: SerializedAttachment): Attachment {
  return {
    ...attachment,
    role: attachment.role ?? "assistant",
  };
}

function mergeCounters(base: AttachmentCounters, overrides: unknown): AttachmentCounters {
  const normalizedOverrides = normalizeCounters(overrides);
  return {
    assistant: {
      image: Math.max(base.assistant.image, normalizedOverrides.assistant.image),
      file: Math.max(base.assistant.file, normalizedOverrides.assistant.file),
      pdf: Math.max(base.assistant.pdf, normalizedOverrides.assistant.pdf),
    },
    user: {
      image: Math.max(base.user.image, normalizedOverrides.user.image),
      file: Math.max(base.user.file, normalizedOverrides.user.file),
      pdf: Math.max(base.user.pdf, normalizedOverrides.user.pdf),
    },
  };
}

function countersFromAttachments(attachments: Attachment[]): AttachmentCounters {
  const counters = emptyCounters();
  for (const attachment of attachments) {
    const suffix = Number(attachment.id.split("-").at(-1));
    if (Number.isFinite(suffix)) {
      counters[attachment.role][attachment.kind] = Math.max(counters[attachment.role][attachment.kind], suffix);
    }
  }
  return counters;
}

function normalizeCounters(value: unknown): AttachmentCounters {
  const counters = emptyCounters();
  if (!isRecord(value)) return counters;

  const assistant = value.assistant;
  const user = value.user;
  if (isKindCounters(assistant)) {
    counters.assistant = mergeKindCounters(counters.assistant, assistant);
  }
  if (isKindCounters(user)) {
    counters.user = mergeKindCounters(counters.user, user);
  }

  if (isKindCounters(value)) {
    counters.assistant = mergeKindCounters(counters.assistant, value);
  }

  return counters;
}

function isKindCounters(value: unknown): value is LegacyAttachmentCounters {
  const kinds = attachmentKinds();
  return isRecord(value)
    && kinds.some((kind) => value[kind] !== undefined)
    && kinds.every((kind) => value[kind] === undefined || typeof value[kind] === "number");
}

function mergeKindCounters(
  base: Record<AttachmentKind, number>,
  overrides: LegacyAttachmentCounters,
): Record<AttachmentKind, number> {
  return {
    image: Math.max(base.image, overrides.image ?? 0),
    file: Math.max(base.file, overrides.file ?? 0),
    pdf: Math.max(base.pdf, overrides.pdf ?? 0),
  };
}

function attachmentKinds(): AttachmentKind[] {
  return ["image", "file", "pdf"];
}

function emptyCounters(): AttachmentCounters {
  return {
    assistant: { image: 0, file: 0, pdf: 0 },
    user: { image: 0, file: 0, pdf: 0 },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
