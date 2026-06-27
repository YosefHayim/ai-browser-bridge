import { isHookCommand, isHookLifecycleEvent, isRecord } from "./hooks.helpers.ts";
import { validateHookFields } from "./hooks.validate.ts";
import type { HookDefinition, RawHookFields } from "./hooks.types.ts";

interface ParseHookEntryInput {
  raw: unknown;
  source: string;
  location: string;
}

/** Parse one hook entry from raw JSON. */
export function parseHookEntry(input: ParseHookEntryInput): { hook?: HookDefinition; errors: string[] } {
  const fields = readHookFields(input.raw);
  const errors = validateHookFields({ fields, source: input.source, location: input.location });
  if (errors.length > 0 || typeof fields.event !== "string" || !isHookLifecycleEvent(fields.event)) {
    return { errors };
  }
  if (!isHookCommand(fields.command)) return { errors };
  return {
    hook: {
      source: input.source,
      event: fields.event,
      command: fields.command,
      name: typeof fields.name === "string" ? fields.name : undefined,
      enabled: fields.enabled !== false,
    },
    errors,
  };
}

function readHookFields(raw: unknown): RawHookFields {
  if (!isRecord(raw)) return {};
  return { event: raw.event, command: raw.command, name: raw.name, enabled: raw.enabled };
}
