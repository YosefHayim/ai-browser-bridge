import { asRecord, isHookLifecycleEvent, isRecord } from "./hooks.helpers.ts";
import { parseHookEntry } from "./hooks.parse-entry.ts";
import type { HookDefinition, ParseHooksResult } from "./hooks.types.ts";

interface ParseHookArrayInput {
  hooksValue: unknown[];
  source: string;
}

/** Parse a hooks array payload. */
export function parseHookArray(input: ParseHookArrayInput): ParseHooksResult {
  const hooks: HookDefinition[] = [];
  const errors: string[] = [];
  for (let index = 0; index < input.hooksValue.length; index += 1) {
    const parsed = parseHookEntry({ raw: input.hooksValue[index], source: input.source, location: String(index) });
    if (parsed.hook) hooks.push(parsed.hook);
    errors.push(...parsed.errors);
  }
  return { hooks, errors };
}

interface ParseHookObjectInput {
  hooksValue: Record<string, unknown>;
  source: string;
}

/** Parse a hooks object keyed by lifecycle event. */
export function parseHookObject(input: ParseHookObjectInput): ParseHooksResult {
  const hooks: HookDefinition[] = [];
  const errors: string[] = [];
  for (const [eventName, value] of Object.entries(input.hooksValue)) {
    const eventErrors = parseHookEventHooks({ eventName, value, source: input.source, hooks });
    errors.push(...eventErrors);
  }
  return { hooks, errors };
}

function parseHookEventHooks(input: {
  eventName: string;
  value: unknown;
  source: string;
  hooks: HookDefinition[];
}): string[] {
  if (!isHookLifecycleEvent(input.eventName)) {
    return [`${input.source}: unsupported hook event ${input.eventName}`];
  }
  if (!Array.isArray(input.value)) {
    return [`${input.source}: ${input.eventName} must be an array`];
  }
  const errors: string[] = [];
  for (let index = 0; index < input.value.length; index += 1) {
    const parsed = parseHookEntry({
      raw: { ...asRecord(input.value[index]), event: input.eventName },
      source: input.source,
      location: `${input.eventName}[${index}]`,
    });
    if (parsed.hook) input.hooks.push(parsed.hook);
    errors.push(...parsed.errors);
  }
  return errors;
}
