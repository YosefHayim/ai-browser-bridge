import type { DomSnapshotNode } from "./attachment-types.ts";
import { inferMime } from "./snapshot-mime.ts";

function readAttr(params: { node: Extract<DomSnapshotNode, { type: "element" }>; name: string }): string | undefined {
  return params.node.attributes[params.name];
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function textOnly(node: DomSnapshotNode): string {
  if (node.type === "text") return node.text;
  return node.children.map(textOnly).join("");
}

function isFileLink(node: Extract<DomSnapshotNode, { type: "element" }>): boolean {
  if (readAttr({ node, name: "download" }) !== undefined) return true;
  const href = readAttr({ node, name: "href" }) ?? "";
  const label = `${readAttr({ node, name: "aria-label" }) ?? ""} ${readAttr({ node, name: "data-testid" }) ?? ""}`.toLowerCase();
  return href.startsWith("blob:") || label.includes("download") || label.includes("file");
}

function attachmentFromImage(node: Extract<DomSnapshotNode, { type: "element" }>) {
  const url = readAttr({ node, name: "currentSrc" }) || readAttr({ node, name: "src" });
  if (!url) return null;
  return { kind: "image" as const, url, filename: optionalText(readAttr({ node, name: "alt" })), mime: inferMime({ url, fallback: "image" }) };
}

function attachmentFromIframe(node: Extract<DomSnapshotNode, { type: "element" }>) {
  const url = readAttr({ node, name: "src" });
  if (!url) return null;
  return {
    kind: "pdf" as const,
    url,
    filename: optionalText(readAttr({ node, name: "title" }) || readAttr({ node, name: "aria-label" })),
    mime: "application/pdf",
  };
}

function attachmentFromFileLink(node: Extract<DomSnapshotNode, { type: "element" }>) {
  const url = readAttr({ node, name: "href" });
  if (!url) return null;
  return {
    kind: "file" as const,
    url,
    filename: optionalText(readAttr({ node, name: "download" })) ?? optionalText(textOnly(node)),
    mime: inferMime({ url, fallback: "file" }),
  };
}

function attachmentFromElement(node: Extract<DomSnapshotNode, { type: "element" }>) {
  if (node.tagName === "img") return attachmentFromImage(node);
  if (node.tagName === "iframe") return attachmentFromIframe(node);
  if (node.tagName === "a" && isFileLink(node)) return attachmentFromFileLink(node);
  return null;
}

export { attachmentFromElement, textOnly };
