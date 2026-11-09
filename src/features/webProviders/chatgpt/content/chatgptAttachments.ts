import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { APIResponse, Page } from "playwright";
import { BRIDGE_DIR_NAME, REPO_DIR_NAME } from "@/config.ts";
import type {
  Attachment,
  AttachmentManifest,
  AttachmentRole,
} from "@/features/conversations/attachments.ts";
import type { CaptureMessagesOptions } from "../../browserProvider.ts";
import { chatGptConversationIdFromUrl } from "../chatgptConversationUrl.ts";
import { SELECTORS } from "../conversation/chatgptControls.ts";

export type DomSnapshotNode =
  | { type: "text"; text: string }
  | {
      type: "element";
      tagName: string;
      attributes: Record<string, string>;
      children: DomSnapshotNode[];
    };

type AttachmentKind = Attachment["kind"];

type AttachmentCounters = Record<AttachmentRole, Record<AttachmentKind, number>>;

type ExtractMessagesOptions = {
  conversationId: string;
  includeUserAttachments?: boolean;
  manifestRoot?: string | undefined;
};

type SerializedAttachment = Omit<Attachment, "role"> & { role?: AttachmentRole };

type ManifestStoreOptions = {
  manifestRoot?: string | undefined;
};

type AttachmentCandidate = {
  kind: AttachmentKind;
  url: string;
  filename?: string;
  mime?: string;
};

type ExtractedContent = {
  text: string;
  attachments: AttachmentCandidate[];
};

type SerializedMessage = {
  role: string;
  messageIndex: number;
  text: string;
  root: DomSnapshotNode;
};

type DownloadResolvedInput = {
  page: Page;
  conversationId: string;
  attachment: Attachment;
  attachments: Attachment[];
  opts: DownloadOptions;
};

type DownloadIdsInput = {
  page: Page;
  conversationId: string;
  ids: string[];
  opts: DownloadAllOptions;
};

type DownloadResult = {
  path: string;
  bytes: number;
};

type DownloadAllResult = DownloadResult & {
  id: string;
  error?: string;
};

type DownloadOptions = {
  outDir?: string;
  repoRoot: string;
  manifestRoot?: string | undefined;
};

type DownloadAllOptions = DownloadOptions & {
  ids?: string[];
};

type SameAttachmentInput = {
  left: Attachment;
  right: Attachment;
};

type ExtensionForAttachmentInput = {
  attachment: Attachment;
  mimeOverride?: string;
};

type WithMissingExtensionInput = {
  filename: string;
  attachment: Attachment;
  mimeOverride?: string;
};

type FilenameForAttachmentInput = {
  attachment: Attachment;
  mimeOverride?: string;
};

type DownloadPathInput = {
  outDir: string;
  attachment: Attachment;
  attachments: Attachment[];
  mimeOverride?: string;
};

type FetchBlobInput = {
  page: Page;
  attachment: Attachment;
};

type DownloadHttpInput = {
  page: Page;
  attachment: Attachment;
  outDir: string;
  attachments: Attachment[];
};

type OutputDirectoryInput = {
  conversationId: string;
  outDir?: string;
  repoRoot: string;
};

type OutputPathInput = {
  outDir: string;
  filename: string;
};

type DisambiguateInput = {
  filename: string;
  id: string;
};

type WriteIfChangedInput = {
  filePath: string;
  bytes: Buffer;
};

const MARKER_PREFIX = "\u0000attachment:";

const MARKER_SUFFIX = "\u0000";

const DOM_SNAPSHOT_HELPERS_SOURCE = `
const GENERATED_IMAGE_SELECTOR = 'img[src*="/backend-api/estuary/content"], img[alt^="Generated image"]';

const serializeMessage = (element, messageIndex) => {
  const authorRole = element.getAttribute("data-message-author-role");
  const role = authorRole === null ? "unknown" : authorRole;
  let text = "";
  if (element instanceof HTMLElement) {
    text = element.innerText;
  } else if (element.textContent !== null) {
    text = element.textContent;
  }
  return {
    role,
    messageIndex,
    text,
    root: snapshotNode(element),
  };
};

// Serialize one conversation turn. Resolves role from an inner role block when present;
// otherwise a turn that only holds a generated image is treated as an assistant message.
// Generated images that render outside the role block (but inside the turn) are appended
// as extra children so the walker still visits them.
const serializeTurn = (turn, messageIndex) => {
  const roleBlock = turn.querySelector("[data-message-author-role]");
  const generatedImages = Array.from(turn.querySelectorAll(GENERATED_IMAGE_SELECTOR));
  if (!roleBlock) {
    if (generatedImages.length === 0) return null;
    let text = "";
    if (turn instanceof HTMLElement) {
      text = turn.innerText;
    } else if (turn.textContent !== null) {
      text = turn.textContent;
    }
    return {
      role: "assistant",
      messageIndex,
      text,
      root: { type: "element", tagName: "div", attributes: {}, children: generatedImages.map(snapshotNode) },
    };
  }
  const message = serializeMessage(roleBlock, messageIndex);
  const outsideBlock = generatedImages.filter((image) => !roleBlock.contains(image));
  if (outsideBlock.length > 0) {
    message.root.children.push(...outsideBlock.map(snapshotNode));
  }
  return message;
};

const turnRole = (turn) => {
  const roleBlock = turn.querySelector("[data-message-author-role]");
  if (roleBlock) {
    const authorRole = roleBlock.getAttribute("data-message-author-role");
    return authorRole === null ? "unknown" : authorRole;
  }
  if (turn.querySelector(GENERATED_IMAGE_SELECTOR)) return "assistant";
  return null;
};

const snapshotNode = (node) => {
  if (node.nodeType === Node.TEXT_NODE) {
    return { type: "text", text: node.textContent === null ? "" : node.textContent };
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
};
`;

const LAST_ASSISTANT_MESSAGE_SNAPSHOT_SOURCE = `
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

export const LAST_ASSISTANT_TURN_STATE_SOURCE = String.raw`
(() => {
  ${DOM_SNAPSHOT_HELPERS_SOURCE}
  const countImageMarkers = (text) => {
    const matches = text.match(/\[image-\d+\]/g);
    return matches ? matches.length : 0;
  };
  const turns = Array.from(document.querySelectorAll('section[data-testid^="conversation-turn-"]'));
  let lastAssistantTurn = null;
  for (const turn of turns) {
    if (turnRole(turn) === "assistant") lastAssistantTurn = turn;
  }
  if (!lastAssistantTurn) {
    return { text: "", assetCount: 0, loadedAssetCount: 0, pendingAssetCount: 0, expectedImageMarkerCount: 0 };
  }
  const images = Array.from(lastAssistantTurn.querySelectorAll(GENERATED_IMAGE_SELECTOR));
  let loadedAssetCount = 0;
  let pendingAssetCount = 0;
  for (const node of images) {
    if (node instanceof HTMLImageElement) {
      if (node.complete && node.naturalWidth > 0) loadedAssetCount += 1;
      else pendingAssetCount += 1;
    } else {
      pendingAssetCount += 1;
    }
  }
  const roleBlock = lastAssistantTurn.querySelector('[data-message-author-role="assistant"]');
  let rawText = "";
  if (roleBlock instanceof HTMLElement) {
    rawText = roleBlock.innerText;
  } else if (lastAssistantTurn.innerText) {
    rawText = lastAssistantTurn.innerText;
  }
  const text = rawText.replace(/\s+/g, " ").trim();
  return {
    text,
    assetCount: images.length,
    loadedAssetCount,
    pendingAssetCount,
    expectedImageMarkerCount: countImageMarkers(text),
  };
})()
`;

const ALL_MESSAGES_SNAPSHOT_SOURCE = `
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
    let turnIndex = -1;
    if (role === "assistant") turnIndex = assistantIndex;
    else if (role === "user") turnIndex = userIndex;
    const message = serializeTurn(turn, turnIndex);
    if (message) messages.push(message);
  }
  return messages;
})()
`;

// Raw row example: "path/with\\bad:chars" unsafe filename chars should match.
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally strips control characters from filename candidates
const UNSAFE_FILENAME_CHARS = /[\\/\0-\x1f\x7f]/g;

const MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const EXTENSION_MIMES = [
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
] as const;

const isNodeError = (error: unknown): error is NodeJS.ErrnoException => {
  return typeof error === "object" && error !== null && "code" in error;
};

const registeredAttachment = (attachmentDetails: {
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
}): Attachment => {
  const existing = findExistingAttachment(attachmentDetails);
  if (existing) return reuseExisting({ ctx: attachmentDetails, existing });
  return createAttachment(attachmentDetails);
};

const reuseExisting = (params: {
  ctx: { usedExistingIds: Set<string> };
  existing: Attachment;
}): Attachment => {
  params.ctx.usedExistingIds.add(params.existing.id);
  return params.existing;
};

const createAttachment = (attachmentDetails: {
  item: ExtractedContent["attachments"][number];
  params: {
    role: AttachmentRole;
    messageIndex: number;
    counters: AttachmentCounters;
    createdAt: string;
  };
  newAttachments: Attachment[];
}): Attachment => {
  attachmentDetails.params.counters[attachmentDetails.params.role][attachmentDetails.item.kind] +=
    1;
  const attachment = newAttachment(attachmentDetails);
  attachmentDetails.newAttachments.push(attachment);
  return attachment;
};

const findExistingAttachment = (attachmentDetails: {
  item: ExtractedContent["attachments"][number];
  params: { role: AttachmentRole; messageIndex: number; existing: Attachment[] };
  usedExistingIds: Set<string>;
}): Attachment | undefined => {
  return attachmentDetails.params.existing.find(
    (attachment) =>
      !attachmentDetails.usedExistingIds.has(attachment.id) &&
      attachment.role === attachmentDetails.params.role &&
      attachment.messageIndex === attachmentDetails.params.messageIndex &&
      attachment.kind === attachmentDetails.item.kind &&
      attachment.url === attachmentDetails.item.url,
  );
};

const newAttachment = (attachmentDetails: {
  item: ExtractedContent["attachments"][number];
  params: {
    role: AttachmentRole;
    messageIndex: number;
    counters: AttachmentCounters;
    createdAt: string;
  };
}): Attachment => {
  const suffix =
    attachmentDetails.params.counters[attachmentDetails.params.role][attachmentDetails.item.kind];
  return {
    ...attachmentDetails.item,
    id: attachmentId({
      role: attachmentDetails.params.role,
      kind: attachmentDetails.item.kind,
      suffix,
    }),
    role: attachmentDetails.params.role,
    messageIndex: attachmentDetails.params.messageIndex,
    createdAt: attachmentDetails.params.createdAt,
  };
};

const attachmentId = (params: {
  role: AttachmentRole;
  kind: AttachmentKind;
  suffix: number;
}): string => {
  return params.role === "user"
    ? `user-${params.kind}-${params.suffix}`
    : `${params.kind}-${params.suffix}`;
};

const registerExtractedContent = async (params: {
  conversationId: string;
  messageIndex: number;
  extracted: ExtractedContent;
  manifestRoot?: string | undefined;
}): Promise<{ text: string; attachments: Attachment[] }> => {
  const manifest = await loadManifest(params.conversationId, {
    manifestRoot: params.manifestRoot,
  });
  const registered = assignAttachmentIds({
    extracted: params.extracted,
    role: "assistant",
    messageIndex: params.messageIndex,
    counters: countersFromManifest(manifest),
    createdAt: new Date().toISOString(),
    existing: manifest.attachments,
  });
  return finalizeRegistration({ manifest, registered, manifestRoot: params.manifestRoot });
};

const assignAttachmentIds = (params: {
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
} => {
  const usedExistingIds = new Set<string>();
  const newAttachments: Attachment[] = [];
  const attachments = params.extracted.attachments.map((item) =>
    registeredAttachment({ item, params, usedExistingIds, newAttachments }),
  );
  return {
    text: replaceMarkers({ text: params.extracted.text, attachments }),
    attachments,
    newAttachments,
    counters: params.counters,
  };
};

const finalizeRegistration = async (params: {
  manifest: Awaited<ReturnType<typeof loadManifest>>;
  registered: ReturnType<typeof assignAttachmentIds>;
  manifestRoot?: string | undefined;
}): Promise<{ text: string; attachments: Attachment[] }> => {
  params.manifest.attachments.push(...params.registered.newAttachments);
  params.manifest.counters = params.registered.counters;
  await saveManifest(params.manifest, { manifestRoot: params.manifestRoot });
  return { text: params.registered.text, attachments: params.registered.attachments };
};

const replaceMarkers = (params: { text: string; attachments: Attachment[] }): string => {
  let content = params.text;
  for (let index = 0; index < params.attachments.length; index += 1) {
    const attachmentId = params.attachments[index]?.id;
    const markerId = attachmentId === undefined ? "" : attachmentId;
    content = content.replace(markerFor(index), `[${markerId}]`);
  }
  return content;
};

const markerFor = (index: number): string => {
  return `${MARKER_PREFIX}${index}${MARKER_SUFFIX}`;
};

export const downloadAttachment = async (
  page: Page,
  conversationId: string,
  id: string,
  downloadOptions: DownloadOptions,
): Promise<DownloadResult> => {
  const manifest = await loadManifest(conversationId, {
    manifestRoot: downloadOptions.manifestRoot,
  });
  const attachment = manifest.attachments.find((attachment: Attachment) => attachment.id === id);
  if (!attachment)
    throw new AttachmentDownloadError(id, undefined, `Attachment not found in manifest: ${id}`);
  return downloadResolvedAttachment({
    page,
    conversationId,
    attachment,
    attachments: manifest.attachments,
    opts: downloadOptions,
  });
};

export const downloadAll = async (
  page: Page,
  conversationId: string,
  downloadAllOptions: DownloadAllOptions,
): Promise<DownloadAllResult[]> => {
  const manifest = await loadManifest(conversationId, {
    manifestRoot: downloadAllOptions.manifestRoot,
  });
  const ids =
    downloadAllOptions.ids === undefined
      ? manifest.attachments.map((attachment: Attachment) => attachment.id)
      : downloadAllOptions.ids;
  const downloadResults = await downloadIds({
    page,
    conversationId,
    ids,
    opts: downloadAllOptions,
  });
  if (
    downloadResults.length > 0 &&
    downloadResults.every((downloadResult) => downloadResult.error)
  ) {
    const failedIds = downloadAllOptions.ids === undefined ? "*" : downloadAllOptions.ids.join(",");
    throw new AttachmentDownloadError(
      failedIds,
      undefined,
      `Failed to download all attachments for conversation ${conversationId}`,
      downloadResults,
    );
  }
  return downloadResults;
};

const downloadResolvedAttachment = async (
  input: DownloadResolvedInput,
): Promise<DownloadResult> => {
  const outDir = outputDirectory({
    conversationId: input.conversationId,
    outDir: input.opts.outDir,
    repoRoot: input.opts.repoRoot,
  });
  await mkdir(outDir, { recursive: true });
  try {
    if (isHttpUrl(input.attachment.url)) {
      return await downloadHttpAttachment({
        page: input.page,
        attachment: input.attachment,
        outDir,
        attachments: input.attachments,
      });
    }
    const filePath = await availableDownloadPath({
      outDir,
      attachment: input.attachment,
      attachments: input.attachments,
    });
    const bytes = input.attachment.url.startsWith("blob:")
      ? await fetchBlobBytes({ page: input.page, attachment: input.attachment })
      : parseDataUrl(input.attachment);
    return await writeIfChanged({ filePath, bytes });
  } catch (error) {
    if (error instanceof AttachmentDownloadError) throw error;
    throw new AttachmentDownloadError(
      input.attachment.id,
      input.attachment.url,
      `Failed to download attachment ${input.attachment.id}`,
      error,
    );
  }
};

const downloadIds = async (input: DownloadIdsInput): Promise<DownloadAllResult[]> => {
  const downloadResults: DownloadAllResult[] = [];
  for (const attachmentId of input.ids) {
    downloadResults.push(await downloadOneId({ input, attachmentId }));
  }
  return downloadResults;
};

const downloadOneId = async (input: {
  input: DownloadIdsInput;
  attachmentId: string;
}): Promise<DownloadAllResult> => {
  try {
    const downloaded = await downloadAttachment(
      input.input.page,
      input.input.conversationId,
      input.attachmentId,
      input.input.opts,
    );
    return { id: input.attachmentId, ...downloaded };
  } catch (error) {
    return {
      id: input.attachmentId,
      path: "",
      bytes: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export class AttachmentDownloadError extends Error {
  readonly id: string;
  readonly url: string | undefined;
  override readonly cause: unknown;
  constructor(id: string, url: string | undefined, message: string, cause?: unknown) {
    super(message);
    this.name = "AttachmentDownloadError";
    this.id = id;
    this.url = url;
    this.cause = cause;
  }
}

const parseDataUrl = (attachment: Attachment): Buffer => {
  // Matches data URLs like data:image/png;base64,iVBORw0KGgo=.
  // Named captures: metadata before the comma, encodedPayload after it.
  const match = /^data:(?<metadata>[^,]*),(?<encodedPayload>.*)$/s.exec(attachment.url);
  if (!match?.groups) {
    throw new AttachmentDownloadError(
      attachment.id,
      attachment.url,
      `Invalid data URL for attachment ${attachment.id}`,
    );
  }
  const metadata = match.groups.metadata === undefined ? "" : match.groups.metadata;
  const encodedPayload =
    match.groups.encodedPayload === undefined ? "" : match.groups.encodedPayload;
  return decodeDataUrlBytes({ metadata, encodedPayload });
};

const decodeDataUrlBytes = (input: { metadata: string; encodedPayload: string }): Buffer => {
  if (input.metadata.split(";").includes("base64")) {
    return Buffer.from(input.encodedPayload, "base64");
  }
  return Buffer.from(decodeURIComponent(input.encodedPayload), "utf8");
};

const sanitizeFilename = (value: string | undefined): string | undefined => {
  const sanitized = value?.replace(UNSAFE_FILENAME_CHARS, "").replace(/^\.+/, "").trim();
  return sanitized ? sanitized : undefined;
};

const filenameFromUrl = (url: string): string | undefined => {
  try {
    const parsed = new URL(url);
    const basename = path.posix.basename(parsed.pathname);
    return basename && basename !== "/" ? decodeURIComponent(basename) : undefined;
  } catch {
    return undefined;
  }
};

const isSameAttachment = (input: SameAttachmentInput): boolean => {
  return (
    input.left.id === input.right.id &&
    input.left.url === input.right.url &&
    input.left.filename === input.right.filename
  );
};

const extensionForMime = (mime: string | undefined): string | undefined => {
  const normalized = mime?.toLowerCase().split(";")[0]?.trim();
  return normalized ? MIME_EXTENSIONS[normalized] : undefined;
};

const extensionForAttachment = (input: ExtensionForAttachmentInput): string => {
  const overrideExtension = extensionForMime(input.mimeOverride);
  const attachmentExtension = extensionForMime(input.attachment.mime);
  const mimeExtension = overrideExtension === undefined ? attachmentExtension : overrideExtension;
  if (mimeExtension) return mimeExtension;
  if (input.attachment.kind === "image") return ".png";
  if (input.attachment.kind === "pdf") return ".pdf";
  return "";
};

const withMissingExtension = (input: WithMissingExtensionInput): string => {
  if (path.extname(input.filename)) return input.filename;
  return `${input.filename}${extensionForAttachment({ attachment: input.attachment, mimeOverride: input.mimeOverride })}`;
};

const filenameForAttachment = (input: FilenameForAttachmentInput): string => {
  const preferred = preferredFilename(input);
  if (preferred) return preferred;
  const fallback = sanitizeFilename(
    `${input.attachment.id}${extensionForAttachment({ attachment: input.attachment, mimeOverride: input.mimeOverride })}`,
  );
  if (fallback === undefined) return input.attachment.id;
  return fallback;
};

const preferredFilename = (input: FilenameForAttachmentInput): string | undefined => {
  const preferred = sanitizeFilename(input.attachment.filename);
  if (preferred)
    return withMissingExtension({
      filename: preferred,
      attachment: input.attachment,
      mimeOverride: input.mimeOverride,
    });
  return sanitizeFilename(filenameFromUrl(input.attachment.url));
};

const availableDownloadPath = async (input: DownloadPathInput): Promise<string> => {
  const filename = filenameForAttachment({
    attachment: input.attachment,
    mimeOverride: input.mimeOverride,
  });
  const filePath = outputPath({ outDir: input.outDir, filename });
  if ((await existingSize(filePath)) === undefined) return filePath;
  return collisionFreeDownloadPath({ input, filename, filePath });
};

const collisionFreeDownloadPath = async (input: {
  input: DownloadPathInput;
  filename: string;
  filePath: string;
}): Promise<string> => {
  const owner = input.input.attachments.find(
    (item) =>
      filenameForAttachment({ attachment: item, mimeOverride: input.input.mimeOverride }) ===
      input.filename,
  );
  if (!owner || isSameAttachment({ left: owner, right: input.input.attachment }))
    return input.filePath;
  return outputPath({
    outDir: input.input.outDir,
    filename: disambiguateFilename({ filename: input.filename, id: input.input.attachment.id }),
  });
};

const fetchBlobBytes = async (input: FetchBlobInput): Promise<Buffer> => {
  try {
    const bytes = await input.page.evaluate(async (url: string): Promise<number[] | Uint8Array> => {
      const blobFetch = await fetch(url);
      if (!blobFetch.ok) throw new Error(`Blob fetch failed with HTTP ${blobFetch.status}`);
      return new Uint8Array(await blobFetch.arrayBuffer());
    }, input.attachment.url);
    return Buffer.from(bytes);
  } catch (error) {
    throw new AttachmentDownloadError(
      input.attachment.id,
      input.attachment.url,
      `Failed to fetch blob attachment ${input.attachment.id}`,
      error,
    );
  }
};

const downloadHttpAttachment = async (input: DownloadHttpInput): Promise<DownloadResult> => {
  const httpResponse = await input.page.context().request.get(input.attachment.url);
  if (!httpResponse.ok())
    throwFailedHttpAttachment({ attachment: input.attachment, status: httpResponse.status() });
  return await saveHttpAttachmentResponse({
    outDir: input.outDir,
    attachment: input.attachment,
    attachments: input.attachments,
    httpResponse,
  });
};

const saveHttpAttachmentResponse = async (input: {
  outDir: string;
  attachment: Attachment;
  attachments: Attachment[];
  httpResponse: APIResponse;
}): Promise<DownloadResult> => {
  const headers = input.httpResponse.headers();
  const filePath = await availableDownloadPath({
    outDir: input.outDir,
    attachment: input.attachment,
    attachments: input.attachments,
    mimeOverride: headers["content-type"],
  });
  const contentLength = Number(headers["content-length"]);
  if (Number.isSafeInteger(contentLength) && (await existingSize(filePath)) === contentLength) {
    return { path: filePath, bytes: contentLength };
  }
  return writeIfChanged({ filePath, bytes: await input.httpResponse.body() });
};

const throwFailedHttpAttachment = (input: { attachment: Attachment; status: number }): void => {
  throw new AttachmentDownloadError(
    input.attachment.id,
    input.attachment.url,
    `Attachment ${input.attachment.id} request failed with HTTP ${input.status}`,
  );
};

// Default: <repo>/.bridge/downloads/<conversationId>
const outputDirectory = (input: OutputDirectoryInput): string => {
  if (input.outDir) return path.resolve(input.outDir);
  return path.resolve(input.repoRoot, REPO_DIR_NAME, "downloads", input.conversationId);
};

const outputPath = (input: OutputPathInput): string => {
  const resolvedOutDir = path.resolve(input.outDir);
  const filePath = path.resolve(resolvedOutDir, input.filename);
  const relativePath = path.relative(resolvedOutDir, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new AttachmentDownloadError(
      "",
      undefined,
      `Invalid attachment output path: ${input.filename}`,
    );
  }
  return filePath;
};

const isHttpUrl = (url: string): boolean => {
  return url.startsWith("https://") || url.startsWith("http://");
};

const disambiguateFilename = (input: DisambiguateInput): string => {
  const extension = path.extname(input.filename);
  if (!extension) return `${input.filename}-${input.id}`;
  return `${input.filename.slice(0, -extension.length)}-${input.id}${extension}`;
};

const existingSize = async (filePath: string): Promise<number | undefined> => {
  try {
    return (await stat(filePath)).size;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
};

const writeIfChanged = async (input: WriteIfChangedInput): Promise<DownloadResult> => {
  if ((await existingSize(input.filePath)) === input.bytes.byteLength) {
    return { path: input.filePath, bytes: input.bytes.byteLength };
  }
  await writeFile(input.filePath, input.bytes);
  return { path: input.filePath, bytes: input.bytes.byteLength };
};

const persistAllMessages = async (params: {
  messages: SerializedMessage[];
  opts: ExtractMessagesOptions;
}): Promise<Array<{ role: string; content: string; attachments: Attachment[] }>> => {
  const manifest = await loadManifest(params.opts.conversationId, {
    manifestRoot: params.opts.manifestRoot,
  });
  const state = {
    manifest,
    counters: countersFromManifest(manifest),
    now: new Date().toISOString(),
  };
  const captured = await mapCapturedMessages({ ...params, ...state });
  return saveCapturedMessages({
    captured,
    manifest: state.manifest,
    counters: state.counters,
    manifestRoot: params.opts.manifestRoot,
  });
};

const saveCapturedMessages = async (params: {
  captured: Array<{ role: string; content: string; attachments: Attachment[] }>;
  manifest: Awaited<ReturnType<typeof loadManifest>>;
  counters: ReturnType<typeof countersFromManifest>;
  manifestRoot?: string | undefined;
}) => {
  params.manifest.counters = params.counters;
  await saveManifest(params.manifest, { manifestRoot: params.manifestRoot });
  return params.captured;
};

const mapCapturedMessages = async (params: {
  messages: SerializedMessage[];
  opts: ExtractMessagesOptions;
  manifest: Awaited<ReturnType<typeof loadManifest>>;
  counters: ReturnType<typeof countersFromManifest>;
  now: string;
}) => {
  const captured: Array<{ role: string; content: string; attachments: Attachment[] }> = [];
  for (const message of params.messages) {
    captured.push(
      await captureMessage({
        message,
        opts: params.opts,
        counters: params.counters,
        now: params.now,
        manifest: params.manifest,
      }),
    );
  }
  return captured;
};

const captureMessage = async (params: {
  message: SerializedMessage;
  opts: ExtractMessagesOptions;
  counters: ReturnType<typeof countersFromManifest>;
  now: string;
  manifest: Awaited<ReturnType<typeof loadManifest>>;
}) => {
  if (!shouldRegisterAttachments({ message: params.message, opts: params.opts })) {
    return { role: params.message.role, content: params.message.text, attachments: [] };
  }
  return registerMessageAttachments(params);
};

const registerMessageAttachments = async (params: {
  message: SerializedMessage;
  counters: ReturnType<typeof countersFromManifest>;
  now: string;
  manifest: Awaited<ReturnType<typeof loadManifest>>;
}) => {
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
  return {
    role: params.message.role,
    content: registered.text,
    attachments: registered.attachments,
  };
};

const shouldRegisterAttachments = (params: {
  message: SerializedMessage;
  opts: ExtractMessagesOptions;
}): boolean => {
  if (params.message.role === "assistant") return true;
  return params.message.role === "user" && params.opts.includeUserAttachments === true;
};

export const extractAssistantContent = async (
  page: Page,
  attachmentDetails: { conversationId: string; manifestRoot?: string | undefined },
): Promise<{ text: string; attachments: Attachment[] }> => {
  const message = await page.evaluate<SerializedMessage | null>(
    LAST_ASSISTANT_MESSAGE_SNAPSHOT_SOURCE,
  );
  if (!message) return { text: "", attachments: [] };
  return registerExtractedContent({
    conversationId: attachmentDetails.conversationId,
    messageIndex: message.messageIndex,
    extracted: extractContentFromSnapshot(message.root),
    manifestRoot: attachmentDetails.manifestRoot,
  });
};

export const extractAllMessages = async (
  page: Page,
  extractMessagesOptions: ExtractMessagesOptions,
): Promise<Array<{ role: string; content: string; attachments: Attachment[] }>> => {
  const messages = await page.evaluate<SerializedMessage[]>(ALL_MESSAGES_SNAPSHOT_SOURCE);
  return persistAllMessages({ messages, opts: extractMessagesOptions });
};

const attachmentKinds = (): AttachmentKind[] => {
  return ["image", "file", "pdf"];
};

const emptyCounters = (): AttachmentCounters => {
  return {
    assistant: { image: 0, file: 0, pdf: 0 },
    user: { image: 0, file: 0, pdf: 0 },
  };
};

const countersFromAttachments = (attachments: Attachment[]): AttachmentCounters => {
  const counters = emptyCounters();
  for (const attachment of attachments) {
    const suffix = Number(attachment.id.split("-").at(-1));
    if (Number.isFinite(suffix)) {
      counters[attachment.role][attachment.kind] = Math.max(
        counters[attachment.role][attachment.kind],
        suffix,
      );
    }
  }
  return counters;
};

const mergeCounters = (base: AttachmentCounters, overrides: unknown): AttachmentCounters => {
  const currentCounters = readCurrentCounters(overrides);
  if (!currentCounters) return base;
  return {
    assistant: mergeKindCounters(base.assistant, currentCounters.assistant),
    user: mergeKindCounters(base.user, currentCounters.user),
  };
};

const readCurrentCounters = (value: unknown): AttachmentCounters | null => {
  if (!isRecord(value)) return null;
  if (!isKindCounters(value.assistant) || !isKindCounters(value.user)) return null;
  return { assistant: value.assistant, user: value.user };
};

const mergeKindCounters = (
  base: Record<AttachmentKind, number>,
  overrides: Record<AttachmentKind, number>,
): Record<AttachmentKind, number> => {
  return {
    image: Math.max(base.image, overrides.image),
    file: Math.max(base.file, overrides.file),
    pdf: Math.max(base.pdf, overrides.pdf),
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const isKindCounters = (value: unknown): value is Record<AttachmentKind, number> => {
  return isRecord(value) && attachmentKinds().every((kind) => typeof value[kind] === "number");
};

const defaultAttachmentManifestRoot = (): string => {
  return path.join(homedir(), BRIDGE_DIR_NAME, "attachment-manifests");
};

const manifestPath = (conversationId: string, options: ManifestStoreOptions = {}): string => {
  const downloadsRoot = options.manifestRoot
    ? path.resolve(options.manifestRoot)
    : defaultAttachmentManifestRoot();
  const filePath = path.resolve(downloadsRoot, conversationId, "manifest.json");
  if (!filePath.startsWith(`${downloadsRoot}${path.sep}`)) {
    throw new Error(`Invalid conversation id for attachment manifest: ${conversationId}`);
  }
  return filePath;
};

const normalizeAttachment = (attachment: SerializedAttachment): Attachment => {
  const role = attachment.role === undefined ? "assistant" : attachment.role;
  return { ...attachment, role };
};

const normalizeManifest = (params: {
  conversationId: string;
  manifest: Partial<AttachmentManifest>;
}): AttachmentManifest => {
  const attachments = Array.isArray(params.manifest.attachments)
    ? params.manifest.attachments.map(normalizeAttachment)
    : [];
  return {
    conversationId:
      params.manifest.conversationId === undefined
        ? params.conversationId
        : params.manifest.conversationId,
    attachments,
    counters: mergeCounters(countersFromAttachments(attachments), params.manifest.counters),
  };
};

export const loadManifest = async (
  conversationId: string,
  options: ManifestStoreOptions = {},
): Promise<AttachmentManifest> => {
  try {
    const raw = await readFile(manifestPath(conversationId, options), "utf8");
    return normalizeManifest({
      conversationId,
      manifest: JSON.parse(raw) as Partial<AttachmentManifest>,
    });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { conversationId, attachments: [], counters: emptyCounters() };
    }
    throw error;
  }
};

export const saveManifest = async (
  manifest: AttachmentManifest,
  options: ManifestStoreOptions = {},
): Promise<void> => {
  const normalized = normalizeManifest({ conversationId: manifest.conversationId, manifest });
  const filePath = manifestPath(normalized.conversationId, options);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
};

const countersFromManifest = (manifest: AttachmentManifest): AttachmentCounters => {
  return mergeCounters(countersFromAttachments(manifest.attachments), manifest.counters);
};

const inferMimeFromDataUrl = (url: string): string | undefined => {
  // Matches data URL prefixes like data:image/png;base64,... .
  // Named capture mimeType is the MIME type before ";" or ",".
  const dataMatch = /^data:(?<mimeType>[^;,]+)/.exec(url);
  return dataMatch?.groups?.mimeType;
};

const inferMimeFromExtension = (params: {
  url: string;
  fallback: AttachmentKind;
}): string | undefined => {
  const pathWithoutQuery = params.url.split("?")[0];
  const lower = pathWithoutQuery === undefined ? "" : pathWithoutQuery.toLowerCase();
  const mapped = extensionMime(lower);
  if (mapped) return mapped;
  return params.fallback === "image" ? "image/*" : undefined;
};

const extensionMime = (path: string): string | undefined => {
  for (const [suffix, mime] of EXTENSION_MIMES) {
    if (path.endsWith(suffix)) return mime;
  }
  return undefined;
};

const inferMime = (params: { url: string; fallback: AttachmentKind }): string | undefined => {
  const fromDataUrl = inferMimeFromDataUrl(params.url);
  if (fromDataUrl !== undefined) return fromDataUrl;
  return inferMimeFromExtension(params);
};

const readAttr = (params: {
  node: Extract<DomSnapshotNode, { type: "element" }>;
  name: string;
}): string | undefined => {
  return params.node.attributes[params.name];
};

const optionalText = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const textOnly = (node: DomSnapshotNode): string => {
  if (node.type === "text") return node.text;
  return node.children.map(textOnly).join("");
};

const isFileLink = (node: Extract<DomSnapshotNode, { type: "element" }>): boolean => {
  if (readAttr({ node, name: "download" }) !== undefined) return true;
  const hrefAttr = readAttr({ node, name: "href" });
  const href = hrefAttr === undefined ? "" : hrefAttr;
  const ariaLabel = readAttr({ node, name: "aria-label" });
  const testId = readAttr({ node, name: "data-testid" });
  const ariaPart = ariaLabel === undefined ? "" : ariaLabel;
  const testIdPart = testId === undefined ? "" : testId;
  const label = `${ariaPart} ${testIdPart}`.toLowerCase();
  return href.startsWith("blob:") || label.includes("download") || label.includes("file");
};

const attachmentFromImage = (node: Extract<DomSnapshotNode, { type: "element" }>) => {
  const currentSrc = readAttr({ node, name: "currentSrc" });
  const src = readAttr({ node, name: "src" });
  const url = currentSrc === undefined ? src : currentSrc;
  if (url === undefined || url === "") return null;
  return {
    kind: "image" as const,
    url,
    filename: optionalText(readAttr({ node, name: "alt" })),
    mime: inferMime({ url, fallback: "image" }),
  };
};

const attachmentFromIframe = (node: Extract<DomSnapshotNode, { type: "element" }>) => {
  const url = readAttr({ node, name: "src" });
  if (!url) return null;
  const title = readAttr({ node, name: "title" });
  const ariaLabel = readAttr({ node, name: "aria-label" });
  const filenameSource = title === undefined ? ariaLabel : title;
  return {
    kind: "pdf" as const,
    url,
    filename: optionalText(filenameSource),
    mime: "application/pdf",
  };
};

const attachmentFromFileLink = (node: Extract<DomSnapshotNode, { type: "element" }>) => {
  const url = readAttr({ node, name: "href" });
  if (!url) return null;
  return {
    kind: "file" as const,
    url,
    filename: (() => {
      const downloadName = optionalText(readAttr({ node, name: "download" }));
      if (downloadName !== undefined) return downloadName;
      return optionalText(textOnly(node));
    })(),
    mime: inferMime({ url, fallback: "file" }),
  };
};

const attachmentFromElement = (node: Extract<DomSnapshotNode, { type: "element" }>) => {
  if (node.tagName === "img") return attachmentFromImage(node);
  if (node.tagName === "iframe") return attachmentFromIframe(node);
  if (node.tagName === "a" && isFileLink(node)) return attachmentFromFileLink(node);
  return null;
};

const extractContentFromSnapshot = (root: DomSnapshotNode): ExtractedContent => {
  const attachments: AttachmentCandidate[] = [];
  const text = walkSnapshot({ node: root, attachments });
  return { text, attachments };
};

const walkSnapshot = (params: {
  node: DomSnapshotNode;
  attachments: AttachmentCandidate[];
}): string => {
  if (params.node.type === "text") {
    return typeof params.node.text === "string" ? params.node.text : "";
  }
  const attachment = attachmentFromElement(params.node);
  if (attachment) {
    params.attachments.push(attachment);
    return markerFor(params.attachments.length - 1);
  }
  if (params.node.tagName === "br") return "\n";
  return params.node.children
    .map((child) => walkSnapshot({ node: child, attachments: params.attachments }))
    .join("");
};

export const captureAllMessages = async (
  page: Page,
  options: CaptureMessagesOptions = {},
): Promise<Array<{ role: string; content: string }>> => {
  return extractAllMessages(page, {
    conversationId: conversationIdFromPage(page),
    manifestRoot: options.manifestRoot,
  });
};

const sanitizeCapturedText = (value: string): string => {
  return value
    .replace(/\s*\[object Object\]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

export const captureLastResponse = async (
  page: Page,
  options: CaptureMessagesOptions = {},
): Promise<string> => {
  const { text } = await extractAssistantContent(page, {
    conversationId: conversationIdFromPage(page),
    manifestRoot: options.manifestRoot,
  });
  const cleaned = sanitizeCapturedText(text);
  if (cleaned && !/\[object Object\]/.test(text)) return cleaned;
  const fallback = await page
    .locator(SELECTORS.lastResponse)
    .last()
    .innerText()
    .catch(() => "");
  return sanitizeCapturedText(fallback) || cleaned;
};

const conversationIdFromPage = (page: Page): string => {
  const conversationId = chatGptConversationIdFromUrl(page.url());
  if (conversationId === null) return "current";
  return conversationId;
};
