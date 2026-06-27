import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isNodeError } from "../../../domain/errors.ts";
import type { Attachment, AttachmentManifest } from "../../../domain/types.ts";
import type { AttachmentCounters, SerializedAttachment } from "./attachment-types.ts";
import { countersFromAttachments, emptyCounters, mergeCounters } from "./manifest-counters.ts";

function manifestPath(conversationId: string): string {
  const downloadsRoot = path.resolve(process.cwd(), "downloads");
  const filePath = path.resolve(downloadsRoot, conversationId, "manifest.json");
  if (!filePath.startsWith(`${downloadsRoot}${path.sep}`)) {
    throw new Error(`Invalid conversation id for attachment manifest: ${conversationId}`);
  }
  return filePath;
}

function normalizeAttachment(attachment: SerializedAttachment): Attachment {
  return { ...attachment, role: attachment.role ?? "assistant" };
}

function normalizeManifest(params: { conversationId: string; manifest: Partial<AttachmentManifest> }): AttachmentManifest {
  const attachments = Array.isArray(params.manifest.attachments)
    ? params.manifest.attachments.map(normalizeAttachment)
    : [];
  return {
    conversationId: params.manifest.conversationId ?? params.conversationId,
    attachments,
    counters: mergeCounters(countersFromAttachments(attachments), params.manifest.counters),
  };
}

/** Load a conversation attachment manifest, creating an empty one if needed. */
export async function loadManifest(conversationId: string): Promise<AttachmentManifest> {
  try {
    const raw = await readFile(manifestPath(conversationId), "utf8");
    return normalizeManifest({ conversationId, manifest: JSON.parse(raw) as Partial<AttachmentManifest> });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { conversationId, attachments: [], counters: emptyCounters() };
    }
    throw error;
  }
}

/** Persist a conversation attachment manifest. */
export async function saveManifest(manifest: AttachmentManifest): Promise<void> {
  const normalized = normalizeManifest({ conversationId: manifest.conversationId, manifest });
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

/** Derive attachment counters from a manifest's stored attachments and overrides. */
export function countersFromManifest(manifest: AttachmentManifest): AttachmentCounters {
  return mergeCounters(countersFromAttachments(manifest.attachments), manifest.counters);
}
