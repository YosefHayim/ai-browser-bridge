import type { AttachmentKind } from "./attachment-types.ts";

const EXTENSION_MIMES = [
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
] as const;

function inferMimeFromDataUrl(url: string): string | undefined {
  const dataMatch = /^data:([^;,]+)/.exec(url);
  return dataMatch?.[1];
}

function inferMimeFromExtension(params: { url: string; fallback: AttachmentKind }): string | undefined {
  const lower = params.url.split("?")[0]?.toLowerCase() ?? "";
  const mapped = extensionMime(lower);
  if (mapped) return mapped;
  return params.fallback === "image" ? "image/*" : undefined;
}

function extensionMime(path: string): string | undefined {
  for (const [suffix, mime] of EXTENSION_MIMES) {
    if (path.endsWith(suffix)) return mime;
  }
  return undefined;
}

function inferMime(params: { url: string; fallback: AttachmentKind }): string | undefined {
  return inferMimeFromDataUrl(params.url) ?? inferMimeFromExtension(params);
}

export { inferMime };
