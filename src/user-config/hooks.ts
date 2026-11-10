import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { hasErrorCode } from "@/domain/errors.ts";
import { HOOKS_FILE, readHomeHooksPath } from "@/store/paths.ts";

export const HOOK_LIFECYCLE_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SessionEnd",
] as const;

export type HookLifecycleEvent = (typeof HOOK_LIFECYCLE_EVENTS)[number];
type HookCommand = string | readonly string[];
type HookRunStatus = "skipped" | "disabled";

export type HookDefinition = {
  readonly source: string;
  readonly event: HookLifecycleEvent;
  readonly command: HookCommand;
  readonly name?: string;
  readonly enabled: boolean;
};

export type ParseHooksReport = {
  readonly hooks: HookDefinition[];
  readonly errors: string[];
};

export type LoadHooksSettings = {
  readonly repoRoot: string;
  readonly homeDir?: string;
};

export type LoadedHooksSettings = ParseHooksReport & {
  readonly paths: string[];
};

export type HookRunReport = {
  readonly event: HookLifecycleEvent;
  readonly command: HookCommand;
  readonly status: HookRunStatus;
  readonly reason: "hook-command-execution-disabled" | "hook-disabled";
};

type UnparsedHookFields = {
  event?: unknown;
  command?: unknown;
  name?: unknown;
  enabled?: unknown;
};

type HookParseReport = {
  readonly hook?: HookDefinition;
  readonly errors: string[];
};

export const isHookLifecycleEvent = (field: string): field is HookLifecycleEvent => {
  const lifecycleEventNames: readonly string[] = HOOK_LIFECYCLE_EVENTS;
  return lifecycleEventNames.includes(field);
};

export const listHookSettingsPaths = (repoRoot: string, homeDirectory = homedir()): string[] => {
  return [join(repoRoot, ".bridge", HOOKS_FILE), readHomeHooksPath(homeDirectory)];
};

export const parseHooksSettings = (
  unparsedSettings: unknown,
  origin = "inline",
): ParseHooksReport => {
  const hooksSetting = readObjectProperty(unparsedSettings, "hooks");

  const isHooksArray = Array.isArray(hooksSetting);
  if (isHooksArray) {
    return parseHookArray(hooksSetting, origin);
  }

  if (isPlainObject(hooksSetting)) {
    return parseHookObject(hooksSetting, origin);
  }

  return { hooks: [], errors: [`${origin}: hooks must be an array or object`] };
};

// Shell command execution is intentionally disabled; outcomes report skip/disabled only.
export const runHooks = async (
  event: HookLifecycleEvent,
  hooks: readonly HookDefinition[],
): Promise<HookRunReport[]> => {
  const verdicts: HookRunReport[] = [];
  for (const hook of hooks) {
    const isOtherHookEvent = hook.event !== event;
    if (isOtherHookEvent) continue;

    const hookRunReport = readHookRunReport(event, hook);
    verdicts.push(hookRunReport);
  }
  return verdicts;
};

export const loadHooksSettings = async (
  settings: LoadHooksSettings,
): Promise<LoadedHooksSettings> => {
  const paths = listHookSettingsPaths(settings.repoRoot, settings.homeDir);
  const hooks: HookDefinition[] = [];
  const errors: string[] = [];
  for (const path of paths) {
    const parsedFile = await readHookFile(path);

    const isParsedFileMissing = parsedFile == null;
    if (isParsedFileMissing) continue;

    hooks.push(...parsedFile.hooks);
    errors.push(...parsedFile.errors);
  }
  return { paths, hooks, errors };
};

const readHookFile = async (path: string): Promise<ParseHooksReport | null> => {
  let hookFileDocument: string;
  try {
    hookFileDocument = await readFile(path, "utf-8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;

    throw error;
  }
  try {
    const parsedHooks = JSON.parse(hookFileDocument);
    return parseHooksSettings(parsedHooks, path);
  } catch (error) {
    return { hooks: [], errors: [`${path}: invalid JSON (${readErrorMessage(error)})`] };
  }
};

const isHookCommand = (field: unknown): field is HookCommand => {
  const isTypeString = typeof field === "string";
  if (isTypeString) return true;

  const isNotArray = !Array.isArray(field);
  if (isNotArray) return false;

  return field.every((part) => typeof part === "string");
};

const isPlainObject = (field: unknown): field is Record<string, unknown> => {
  return typeof field === "object" && field !== null && !Array.isArray(field);
};

const readObjectProperty = (unparsedSettings: unknown, property: string): unknown => {
  const isNonObjectSettings = !isPlainObject(unparsedSettings);
  if (isNonObjectSettings) return null;

  return unparsedSettings[property];
};

const readErrorMessage = (error: unknown): string => {
  const isErrorObject = error instanceof Error;
  if (isErrorObject) return error.message;

  return String(error);
};

const parseHookArray = (hooksSetting: unknown[], origin: string): ParseHooksReport => {
  const hooks: HookDefinition[] = [];
  const errors: string[] = [];
  for (let index = 0; index < hooksSetting.length; index += 1) {
    const indexLabel = String(index);
    const parsed = parseHookDefinition(hooksSetting[index], origin, indexLabel);

    const hasParsedHook = parsed.hook != null;
    if (hasParsedHook) hooks.push(parsed.hook);

    errors.push(...parsed.errors);
  }
  return { hooks, errors };
};

const parseHookObject = (
  hooksSetting: Record<string, unknown>,
  origin: string,
): ParseHooksReport => {
  const hooks: HookDefinition[] = [];
  const errors: string[] = [];

  for (const [eventName, field] of Object.entries(hooksSetting)) {
    errors.push(...parseHookEventHooks({ eventName, value: field, source: origin, hooks }));
  }

  return { hooks, errors };
};

interface ParseHookEventHooksDetails {
  eventName: string;
  value: unknown;
  source: string;
  hooks: HookDefinition[];
}

const parseHookEventHooks = ({
  eventName,
  value: field,
  source: origin,
  hooks,
}: ParseHookEventHooksDetails): string[] => {
  const isNotHookLifecycleEventEventName = !isHookLifecycleEvent(eventName);
  if (isNotHookLifecycleEventEventName) {
    return [`${origin}: unsupported hook event ${eventName}`];
  }

  const isNotArray = !Array.isArray(field);
  if (isNotArray) {
    return [`${origin}: ${eventName} must be an array`];
  }

  const errors: string[] = [];
  for (let index = 0; index < field.length; index += 1) {
    const line = field[index];
    const isLinePlainObject = isPlainObject(line);
    const fields = isLinePlainObject ? { ...line, event: eventName } : { event: eventName };
    const parsed = parseHookDefinition(fields, origin, `${eventName}[${index}]`);

    const hasParsedHook = parsed.hook != null;
    if (hasParsedHook) hooks.push(parsed.hook);

    errors.push(...parsed.errors);
  }
  return errors;
};

const parseHookDefinition = (
  unparsedHook: unknown,
  origin: string,
  location: string,
): HookParseReport => {
  const fields = readHookFields(unparsedHook);
  const errors = validateHookFields(fields, origin, location);

  const hasErrors = errors.length > 0;
  if (hasErrors) return { errors };

  const { event, command, name, enabled } = fields;

  const isHookEventInvalid = typeof event !== "string" || !isHookLifecycleEvent(event);
  if (isHookEventInvalid) {
    return { errors };
  }

  const isNotHookCommandFieldsCommand = !isHookCommand(command);
  if (isNotHookCommandFieldsCommand) return { errors };

  const isNameString = typeof name === "string";
  const hookName = isNameString ? name : undefined;

  const isHookEnabled = enabled !== false;

  return {
    hook: {
      source: origin,
      event,
      command,
      name: hookName,
      enabled: isHookEnabled,
    },
    errors,
  };
};

const readHookFields = (unparsedHook: unknown): UnparsedHookFields => {
  const isHookNotAnObject = !isPlainObject(unparsedHook);
  if (isHookNotAnObject) return {};

  return {
    event: unparsedHook.event,
    command: unparsedHook.command,
    name: unparsedHook.name,
    enabled: unparsedHook.enabled,
  };
};

const validateHookFields = (
  fields: UnparsedHookFields,
  origin: string,
  location: string,
): string[] => {
  const errors: string[] = [];

  const isHookEventInvalid =
    typeof fields.event !== "string" || !isHookLifecycleEvent(fields.event);
  if (isHookEventInvalid) {
    errors.push(`${origin}: ${location}.event must be a supported lifecycle event`);
  }

  const isNotHookCommandFieldsCommand = !isHookCommand(fields.command);
  if (isNotHookCommandFieldsCommand) {
    errors.push(`${origin}: ${location}.command must be a string or string array`);
  }

  // Only undefined is a missing name; an explicit null is an invalid name.
  const isNameInvalid = fields.name !== undefined && typeof fields.name !== "string";
  if (isNameInvalid) {
    errors.push(`${origin}: ${location}.name must be a string`);
  }

  // Only undefined is a missing flag; an explicit null is an invalid value.
  const isEnabledInvalid = fields.enabled !== undefined && typeof fields.enabled !== "boolean";
  if (isEnabledInvalid) {
    errors.push(`${origin}: ${location}.enabled must be a boolean`);
  }

  return errors;
};

const readHookRunReport = (event: HookLifecycleEvent, hook: HookDefinition): HookRunReport => {
  const isHookDisabled = !hook.enabled;
  if (isHookDisabled) {
    return {
      event,
      command: hook.command,
      status: "disabled",
      reason: "hook-disabled",
    };
  }

  return {
    event,
    command: hook.command,
    status: "skipped",
    reason: "hook-command-execution-disabled",
  };
};
