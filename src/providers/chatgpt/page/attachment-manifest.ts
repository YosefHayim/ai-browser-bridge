import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { BRIDGE_DIRECTORY_NAME } from "@/app-defaults.ts";
import type { Attachment, AttachmentManifest } from "@/attachment-types.ts";
import type {
  AttachmentCounters,
  AttachmentKind,
  ManifestStoreSettings,
  SerializedAttachment,
} from "@/providers/chatgpt/page/attachment-registration.ts";
import { isNodeError } from "@/providers/chatgpt/page/chatgpt-composer.ts";
import {
  ASSISTANT_ROLE,
  DASH,
  FILE_KIND,
  IMAGE_KIND,
  MISSING_FILE_ERROR_CODE,
  PDF_KIND,
  UTF8_ENCODING,
} from "@/providers/chatgpt/page/chatgpt-page-constants.ts";

function listAttachmentKinds(): AttachmentKind[] {
  return [IMAGE_KIND, FILE_KIND, PDF_KIND];
}

function createEmptyCounters(): AttachmentCounters {
  return {
    assistant: { image: 0, file: 0, pdf: 0 },
    user: { image: 0, file: 0, pdf: 0 },
  };
}

export function readCountersFromAttachments(attachments: Attachment[]): AttachmentCounters {
  const counters = createEmptyCounters();
  for (const attachment of attachments) {
    const idLastPart = attachment.id.split(DASH).at(-1);
    const suffix = Number(idLastPart);

    const isSuffixFinite = Number.isFinite(suffix);
    if (isSuffixFinite) {
      counters[attachment.role][attachment.kind] = Math.max(
        counters[attachment.role][attachment.kind],
        suffix,
      );
    }
  }
  return counters;
}

function mergeCounters(base: AttachmentCounters, overrides: unknown): AttachmentCounters {
  const currentCounters = readCurrentCounters(overrides);

  const isCurrentCountersMissing = currentCounters == null;
  if (isCurrentCountersMissing) return base;

  return {
    assistant: mergeKindCounters(base.assistant, currentCounters.assistant),
    user: mergeKindCounters(base.user, currentCounters.user),
  };
}

function readCurrentCounters(field: unknown): AttachmentCounters | null {
  const isNotPlainObject = !isPlainObject(field);
  if (isNotPlainObject) return null;

  const assistantCounters = field.assistant;
  const userCounters = field.user;

  const isKindCountersInvalid = !isKindCounters(assistantCounters) || !isKindCounters(userCounters);
  if (isKindCountersInvalid) return null;

  return { assistant: assistantCounters, user: userCounters };
}

function mergeKindCounters(
  base: Record<AttachmentKind, number>,
  overrides: Record<AttachmentKind, number>,
): Record<AttachmentKind, number> {
  return {
    image: Math.max(base.image, overrides.image),
    file: Math.max(base.file, overrides.file),
    pdf: Math.max(base.pdf, overrides.pdf),
  };
}

function isPlainObject(field: unknown): field is Record<string, unknown> {
  return typeof field === "object" && field !== null;
}

function isKindCounters(field: unknown): field is Record<AttachmentKind, number> {
  return (
    isPlainObject(field) && listAttachmentKinds().every((kind) => typeof field[kind] === "number")
  );
}

function readDefaultAttachmentManifestRoot(): string {
  const homeFolder = homedir();
  return path.join(homeFolder, BRIDGE_DIRECTORY_NAME, "attachment-manifests");
}

function readManifestPath(conversationId: string, settings: ManifestStoreSettings = {}): string {
  const { manifestRoot } = settings;
  const isManifestRootFound = manifestRoot != null && manifestRoot !== "";
  const downloadsRoot = isManifestRootFound
    ? path.resolve(manifestRoot)
    : readDefaultAttachmentManifestRoot();

  const filePath = path.resolve(downloadsRoot, conversationId, "manifest.json");

  const isOutsideDownloadsRoot = !filePath.startsWith(`${downloadsRoot}${path.sep}`);
  if (isOutsideDownloadsRoot) {
    throw new Error(`Invalid conversation id for attachment manifest: ${conversationId}`);
  }

  return filePath;
}

function cleanAttachment(attachment: SerializedAttachment): Attachment {
  const role = attachment.role ?? ASSISTANT_ROLE;
  return { ...attachment, role };
}

function cleanManifest(parameters: {
  conversationId: string;
  manifest: Partial<AttachmentManifest>;
}): AttachmentManifest {
  const manifestAttachments = parameters.manifest.attachments;
  const isAttachmentList = Array.isArray(manifestAttachments);
  const attachments = isAttachmentList ? manifestAttachments.map(cleanAttachment) : [];
  const manifestConversationId = parameters.manifest.conversationId;
  const attachmentCounters = readCountersFromAttachments(attachments);

  return {
    conversationId: manifestConversationId ?? parameters.conversationId,
    attachments,
    counters: mergeCounters(attachmentCounters, parameters.manifest.counters),
  };
}

export async function loadManifest(
  conversationId: string,
  settings: ManifestStoreSettings = {},
): Promise<AttachmentManifest> {
  try {
    const manifestPath = readManifestPath(conversationId, settings);
    const unparsed = await readFile(manifestPath, UTF8_ENCODING);
    return cleanManifest({
      conversationId,
      manifest: JSON.parse(unparsed),
    });
  } catch (error) {
    const isMissingFileError = isNodeError(error) && error.code === MISSING_FILE_ERROR_CODE;
    if (isMissingFileError) {
      return { conversationId, attachments: [], counters: createEmptyCounters() };
    }

    throw error;
  }
}

export async function saveManifest(
  manifest: AttachmentManifest,
  settings: ManifestStoreSettings = {},
): Promise<void> {
  const normalized = cleanManifest({ conversationId: manifest.conversationId, manifest });
  const filePath = readManifestPath(normalized.conversationId, settings);
  const folderPath = path.dirname(filePath);
  await mkdir(folderPath, { recursive: true });
  const indentSpaces = 2;

  await writeFile(filePath, `${JSON.stringify(normalized, null, indentSpaces)}\n`, UTF8_ENCODING);
}

export function readCountersFromManifest(manifest: AttachmentManifest): AttachmentCounters {
  const manifestAttachmentCounters = readCountersFromAttachments(manifest.attachments);
  return mergeCounters(manifestAttachmentCounters, manifest.counters);
}
