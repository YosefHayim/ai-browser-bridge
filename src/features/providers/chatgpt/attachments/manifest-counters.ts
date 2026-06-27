import type { Attachment } from "../../../domain/types.ts";
import type { AttachmentCounters, AttachmentKind, LegacyAttachmentCounters } from "./attachment-types.ts";

/** Supported attachment kinds tracked in manifests. */
export function attachmentKinds(): AttachmentKind[] {
  return ["image", "file", "pdf"];
}

/** Empty per-role attachment counters. */
export function emptyCounters(): AttachmentCounters {
  return {
    assistant: { image: 0, file: 0, pdf: 0 },
    user: { image: 0, file: 0, pdf: 0 },
  };
}

/** Build counters from existing attachment ids in a manifest. */
export function countersFromAttachments(attachments: Attachment[]): AttachmentCounters {
  const counters = emptyCounters();
  for (const attachment of attachments) {
    const suffix = Number(attachment.id.split("-").at(-1));
    if (Number.isFinite(suffix)) {
      counters[attachment.role][attachment.kind] = Math.max(counters[attachment.role][attachment.kind], suffix);
    }
  }
  return counters;
}

/** Merge stored counters with legacy or partial overrides. */
export function mergeCounters(base: AttachmentCounters, overrides: unknown): AttachmentCounters {
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

/** Normalize unknown counter payloads into the current per-role shape. */
export function normalizeCounters(value: unknown): AttachmentCounters {
  const counters = emptyCounters();
  if (!isRecord(value)) return counters;
  return applyLegacyCounters({ counters, value });
}

function applyLegacyCounters(params: { counters: AttachmentCounters; value: Record<string, unknown> }): AttachmentCounters {
  applyRoleCounters({ counters: params.counters, role: "assistant", source: params.value.assistant });
  applyRoleCounters({ counters: params.counters, role: "user", source: params.value.user });
  if (isKindCounters(params.value)) applyRoleCounters({ counters: params.counters, role: "assistant", source: params.value });
  return params.counters;
}

/** Merge one role's kind counters with optional legacy overrides. */
export function mergeKindCounters(
  base: Record<AttachmentKind, number>,
  overrides: LegacyAttachmentCounters,
): Record<AttachmentKind, number> {
  return {
    image: Math.max(base.image, overrides.image ?? 0),
    file: Math.max(base.file, overrides.file ?? 0),
    pdf: Math.max(base.pdf, overrides.pdf ?? 0),
  };
}

function applyRoleCounters(params: {
  counters: AttachmentCounters;
  role: "assistant" | "user";
  source: unknown;
}): void {
  if (!isKindCounters(params.source)) return;
  params.counters[params.role] = mergeKindCounters(params.counters[params.role], params.source);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isKindCounters(value: unknown): value is LegacyAttachmentCounters {
  const kinds = attachmentKinds();
  return isRecord(value)
    && kinds.some((kind) => value[kind] !== undefined)
    && kinds.every((kind) => value[kind] === undefined || typeof value[kind] === "number");
}
