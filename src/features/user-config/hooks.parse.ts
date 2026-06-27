import { isRecord, readObjectProperty } from "./hooks.helpers.ts";
import { parseHookArray, parseHookObject } from "./hooks.parse-collections.ts";
import type { ParseHooksResult } from "./hooks.types.ts";

interface ParseHooksInput {
  raw: unknown;
  source?: string;
}

/** Parse and validate a hooks.json payload without executing anything. */
export function parseHooksConfig(input: ParseHooksInput | unknown, source = "inline"): ParseHooksResult {
  const payload = typeof input === "object" && input !== null && "raw" in input
    ? input as ParseHooksInput
    : { raw: input, source };
  const hooksValue = readObjectProperty(payload.raw, "hooks");
  if (Array.isArray(hooksValue)) return parseHookArray({ hooksValue, source: payload.source ?? source });
  if (isRecord(hooksValue)) return parseHookObject({ hooksValue, source: payload.source ?? source });
  return { hooks: [], errors: [`${payload.source ?? source}: hooks must be an array or object`] };
}
