import {
  type AttachmentCandidate,
  type AttachmentKind,
  createMarker,
  type DomSnapshotNode,
  type ExtractedMessage,
} from "@/providers/chatgpt/page/attachment-registration.ts";
import {
  ARIA_LABEL_ATTRIBUTE,
  BLOB_URL_PREFIX,
  FILE_KIND,
  HREF_ATTRIBUTE,
  IMAGE_KIND,
  NEWLINE,
  PDF_KIND,
  PDF_MIME_TYPE,
  TEST_ID_ATTRIBUTE,
} from "@/providers/chatgpt/page/chatgpt-page-constants.ts";
import { EXTENSION_MIMES } from "@/providers/chatgpt/page/dom-snapshot-scripts.ts";

const SRC_ATTRIBUTE = "src";

const DOWNLOAD_ATTRIBUTE = "download";

const LEAF_NODE_TYPE = "text";

function inferMimeFromEmbeddedUrl(url: string): string | undefined {
  const detailsHit = /^data:(?<mimeType>[^;,]+)/.exec(url);
  return detailsHit?.groups?.mimeType;
}

function inferMimeFromExtension(parameters: {
  url: string;
  fallback: AttachmentKind;
}): string | undefined {
  const pathWithoutQuery = parameters.url.split("?")[0];
  const isPathWithoutQueryMissing = pathWithoutQuery == null;
  const lowerCasePath = isPathWithoutQueryMissing ? "" : pathWithoutQuery.toLowerCase();

  const extensionMime = readExtensionMime(lowerCasePath);

  const isExtensionMimeFound = extensionMime != null && extensionMime !== "";
  if (isExtensionMimeFound) return extensionMime;

  const isImageFallback = parameters.fallback === IMAGE_KIND;

  return isImageFallback ? "image/*" : undefined;
}

function readExtensionMime(path: string): string | null {
  for (const [suffix, mime] of EXTENSION_MIMES) {
    const isPathEndsWithSuffix = path.endsWith(suffix);
    if (isPathEndsWithSuffix) return mime;
  }
  return null;
}

function inferMime(parameters: { url: string; fallback: AttachmentKind }): string | undefined {
  const fromEmbeddedUrl = inferMimeFromEmbeddedUrl(parameters.url);

  const hasFromUrl = fromEmbeddedUrl != null;
  if (hasFromUrl) return fromEmbeddedUrl;

  return inferMimeFromExtension(parameters);
}

function readAttr(parameters: {
  node: Extract<DomSnapshotNode, { type: "element" }>;
  name: string;
}): string | undefined {
  return parameters.node.attributes[parameters.name];
}

function readOptionalString(field: string | undefined): string | undefined {
  const trimmed = field?.trim();
  const isTrimmedFound = trimmed != null && trimmed !== "";
  return isTrimmedFound ? trimmed : undefined;
}

function readStringOnly(node: DomSnapshotNode): string {
  const isNodeTypeString = node.type === LEAF_NODE_TYPE;
  if (isNodeTypeString) return node.text;

  return node.children.map(readStringOnly).join("");
}

function isFileLink(node: Extract<DomSnapshotNode, { type: "element" }>): boolean {
  const hasDownloadAttribute = readAttr({ node, name: DOWNLOAD_ATTRIBUTE }) != null;
  if (hasDownloadAttribute) return true;

  const hrefAttr = readAttr({ node, name: HREF_ATTRIBUTE });
  const isHrefAttrMissing = hrefAttr == null;
  const href = isHrefAttrMissing ? "" : hrefAttr;
  const ariaLabel = readAttr({ node, name: ARIA_LABEL_ATTRIBUTE });
  const testId = readAttr({ node, name: TEST_ID_ATTRIBUTE });
  const isAriaLabelMissing = ariaLabel == null;
  const ariaPart = isAriaLabelMissing ? "" : ariaLabel;
  const isTestIdMissing = testId == null;
  const testIdPart = isTestIdMissing ? "" : testId;
  const label = `${ariaPart} ${testIdPart}`.toLowerCase();
  return (
    href.startsWith(BLOB_URL_PREFIX) ||
    label.includes(DOWNLOAD_ATTRIBUTE) ||
    label.includes(FILE_KIND)
  );
}

function readAttachmentFromImage(node: Extract<DomSnapshotNode, { type: "element" }>) {
  const currentSrc = readAttr({ node, name: "currentSrc" });
  const src = readAttr({ node, name: SRC_ATTRIBUTE });

  const isCurrentSrcMissing = currentSrc == null;
  const url = isCurrentSrcMissing ? src : currentSrc;

  const isUrlBlank = url == null || url === "";
  if (isUrlBlank) return null;

  const altAttribute = readAttr({ node, name: "alt" });
  return {
    kind: IMAGE_KIND,
    url,
    filename: readOptionalString(altAttribute),
    mime: inferMime({ url, fallback: IMAGE_KIND }),
  };
}

function readAttachmentFromIframe(node: Extract<DomSnapshotNode, { type: "element" }>) {
  const url = readAttr({ node, name: SRC_ATTRIBUTE });

  const isUrlEmpty = !url;
  if (isUrlEmpty) return null;

  const title = readAttr({ node, name: "title" });
  const ariaLabel = readAttr({ node, name: ARIA_LABEL_ATTRIBUTE });
  const isTitleMissing = title == null;
  const filenameOrigin = isTitleMissing ? ariaLabel : title;
  return {
    kind: PDF_KIND,
    url,
    filename: readOptionalString(filenameOrigin),
    mime: PDF_MIME_TYPE,
  };
}

function readAttachmentFromFileLink(node: Extract<DomSnapshotNode, { type: "element" }>) {
  const url = readAttr({ node, name: HREF_ATTRIBUTE });

  const isUrlEmpty = !url;
  if (isUrlEmpty) return null;

  return {
    kind: FILE_KIND,
    url,
    filename: (() => {
      const downloadAttribute = readAttr({ node, name: DOWNLOAD_ATTRIBUTE });
      const downloadName = readOptionalString(downloadAttribute);

      const hasDownloadName = downloadName != null;
      if (hasDownloadName) return downloadName;

      const nodeString = readStringOnly(node);
      return readOptionalString(nodeString);
    })(),
    mime: inferMime({ url, fallback: FILE_KIND }),
  };
}

function readAttachmentFromElement(node: Extract<DomSnapshotNode, { type: "element" }>) {
  const isNodeTagNameImg = node.tagName === "img";
  if (isNodeTagNameImg) return readAttachmentFromImage(node);

  const isNodeTagNameIframe = node.tagName === "iframe";
  if (isNodeTagNameIframe) return readAttachmentFromIframe(node);

  const isFileLinkAnchor = node.tagName === "a" && isFileLink(node);
  if (isFileLinkAnchor) return readAttachmentFromFileLink(node);

  return null;
}

export function extractMessageFromSnapshot(root: DomSnapshotNode): ExtractedMessage {
  const attachments: AttachmentCandidate[] = [];
  const string = walkSnapshot({ node: root, attachments });
  return { text: string, attachments };
}

function walkSnapshot(parameters: {
  node: DomSnapshotNode;
  attachments: AttachmentCandidate[];
}): string {
  const node = parameters.node;

  const isLeafNode = node.type === LEAF_NODE_TYPE;
  if (isLeafNode) {
    const isSnapshotStringNode = typeof node.text === "string";
    return isSnapshotStringNode ? node.text : "";
  }

  const attachment = readAttachmentFromElement(node);

  const isAttachmentFound = attachment != null;
  if (isAttachmentFound) {
    parameters.attachments.push(attachment);
    return createMarker(parameters.attachments.length - 1);
  }

  const isNodeTagNameBr = node.tagName === "br";
  if (isNodeTagNameBr) return NEWLINE;

  return node.children
    .map((child) => walkSnapshot({ node: child, attachments: parameters.attachments }))
    .join("");
}

export const PLUGINS_SETTINGS_URL = "https://chatgpt.com/settings/plugins-settings";
