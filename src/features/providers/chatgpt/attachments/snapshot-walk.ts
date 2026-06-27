import type { AttachmentCandidate, DomSnapshotNode, ExtractedContent } from "./attachment-types.ts";
import { MARKER_PREFIX, MARKER_SUFFIX } from "./attachment-types.ts";
import { attachmentFromElement } from "./snapshot-walk.helpers.ts";

/** Convert a DOM snapshot into text with temporary attachment markers. */
export function extractContentFromSnapshot(root: DomSnapshotNode): ExtractedContent {
  const attachments: AttachmentCandidate[] = [];
  const text = walkSnapshot({ node: root, attachments });
  return { text, attachments };
}

function walkSnapshot(params: { node: DomSnapshotNode; attachments: AttachmentCandidate[] }): string {
  if (params.node.type === "text") return params.node.text;
  const attachment = attachmentFromElement(params.node);
  if (attachment) {
    params.attachments.push(attachment);
    return markerFor(params.attachments.length - 1);
  }
  if (params.node.tagName === "br") return "\n";
  return params.node.children.map((child) => walkSnapshot({ node: child, attachments: params.attachments })).join("");
}

function markerFor(index: number): string {
  return `${MARKER_PREFIX}${index}${MARKER_SUFFIX}`;
}
