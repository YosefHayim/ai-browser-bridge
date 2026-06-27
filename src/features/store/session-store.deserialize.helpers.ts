import type { SessionEvent } from "./session-store.types.ts";
import { normalizeRole, readOptionalString, isRecord } from "./session-store.normalizers.ts";

/** Context for applying optional fields to a session event. */
export interface ApplyOptionalEventFieldsContext {
  event: SessionEvent;
  record: Record<string, unknown>;
  source: string;
}

/** Apply optional event fields from a parsed JSON record. */
export function applyOptionalEventFields(ctx: ApplyOptionalEventFieldsContext): void {
  applyOptionalStrings(ctx);
  applyEventData(ctx);
}

/** Copy optional string fields onto a session event. */
function applyOptionalStrings(ctx: ApplyOptionalEventFieldsContext): void {
  applyRoleField(ctx);
  applyNameStatusContentFields(ctx);
}

/** Apply optional role field. */
function applyRoleField(ctx: ApplyOptionalEventFieldsContext): void {
  const role = readOptionalString(ctx.record, "role", ctx.source);
  if (role !== undefined) ctx.event.role = normalizeRole(role, ctx.source);
}

/** Apply optional name, status, and content fields. */
function applyNameStatusContentFields(ctx: ApplyOptionalEventFieldsContext): void {
  applyOptionalField({ ctx, field: "name" });
  applyOptionalField({ ctx, field: "status" });
  applyOptionalField({ ctx, field: "content" });
}

/** Apply one optional string field when present on the record. */
function applyOptionalField(input: { ctx: ApplyOptionalEventFieldsContext; field: "name" | "status" | "content" }): void {
  const value = readOptionalString(input.ctx.record, input.field, input.ctx.source);
  if (value !== undefined) input.ctx.event[input.field] = value;
}

/** Attach structured `data` when present on the JSON record. */
function applyEventData(ctx: ApplyOptionalEventFieldsContext): void {
  const data = ctx.record.data;
  if (data === undefined) return;
  if (!isRecord(data)) throw new Error(`Expected data to be an object in ${ctx.source}`);
  ctx.event.data = data;
}
