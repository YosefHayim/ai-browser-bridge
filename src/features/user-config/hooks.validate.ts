import type { RawHookFields } from "./hooks.types.ts";
import { isHookCommand, isHookLifecycleEvent } from "./hooks.helpers.ts";

interface ValidateHookFieldsInput {
  fields: RawHookFields;
  source: string;
  location: string;
}

/** Validate raw hook fields and return error messages. */
export function validateHookFields(input: ValidateHookFieldsInput): string[] {
  const errors: string[] = [];
  validateHookEvent({ input, errors });
  validateHookCommandField({ input, errors });
  validateHookOptionalFields({ input, errors });
  return errors;
}

function validateHookEvent(input: { input: ValidateHookFieldsInput; errors: string[] }): void {
  if (typeof input.input.fields.event !== "string" || !isHookLifecycleEvent(input.input.fields.event)) {
    input.errors.push(`${input.input.source}: ${input.input.location}.event must be a supported lifecycle event`);
  }
}

function validateHookCommandField(input: { input: ValidateHookFieldsInput; errors: string[] }): void {
  if (!isHookCommand(input.input.fields.command)) {
    input.errors.push(`${input.input.source}: ${input.input.location}.command must be a string or string array`);
  }
}

function validateHookOptionalFields(input: { input: ValidateHookFieldsInput; errors: string[] }): void {
  if (input.input.fields.name !== undefined && typeof input.input.fields.name !== "string") {
    input.errors.push(`${input.input.source}: ${input.input.location}.name must be a string`);
  }
  if (input.input.fields.enabled !== undefined && typeof input.input.fields.enabled !== "boolean") {
    input.errors.push(`${input.input.source}: ${input.input.location}.enabled must be a boolean`);
  }
}
