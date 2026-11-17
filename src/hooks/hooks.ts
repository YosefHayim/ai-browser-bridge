import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { readErrorMessage } from "@/read-error-message.ts";
import { readFileIfPresent } from "@/read-file-if-present.ts";
import { HOOKS_FILE, readHomeHooksPath } from "@/repo-files/paths.ts";

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

type HookParseReport = {
  readonly hook?: HookDefinition;
  readonly errors: string[];
};

export function isHookLifecycleEvent(field: string): field is HookLifecycleEvent {
  const lifecycleEventNames: readonly string[] = HOOK_LIFECYCLE_EVENTS;
  return lifecycleEventNames.includes(field);
}

export function listHookSettingsPaths(repoRoot: string, homeDirectory = homedir()): string[] {
  return [join(repoRoot, ".bridge", HOOKS_FILE), readHomeHooksPath(homeDirectory)];
}

export function parseHooksSettings(unparsedSettings: unknown, origin = "inline"): ParseHooksReport {
  const hooksSetting = readObjectProperty(unparsedSettings, "hooks");

  const isHooksArray = Array.isArray(hooksSetting);
  if (isHooksArray) {
    return parseHookArray(hooksSetting, origin);
  }

  if (isPlainObject(hooksSetting)) {
    return parseHookObject(hooksSetting, origin);
  }

  return { hooks: [], errors: [`${origin}: hooks must be an array or object`] };
}

// Shell command execution is intentionally disabled; outcomes report skip/disabled only.
export async function runHooks(
  event: HookLifecycleEvent,
  hooks: readonly HookDefinition[],
): Promise<HookRunReport[]> {
  const verdicts: HookRunReport[] = [];
  for (const hook of hooks) {
    const isOtherHookEvent = hook.event !== event;
    if (isOtherHookEvent) continue;

    const hookRunReport = readHookRunReport(event, hook);
    verdicts.push(hookRunReport);
  }
  return verdicts;
}

export async function loadHooksSettings(settings: LoadHooksSettings): Promise<LoadedHooksSettings> {
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
}

async function readHookFile(path: string): Promise<ParseHooksReport | null> {
  const hookFileDocument = await readFileIfPresent(path);

  const isHookFileMissing = hookFileDocument == null;
  if (isHookFileMissing) return null;

  try {
    const parsedHooks = JSON.parse(hookFileDocument);
    return parseHooksSettings(parsedHooks, path);
  } catch (error) {
    return { hooks: [], errors: [`${path}: invalid JSON (${readErrorMessage(error)})`] };
  }
}

function isPlainObject(field: unknown): field is Record<string, unknown> {
  return typeof field === "object" && field !== null && !Array.isArray(field);
}

function readObjectProperty(unparsedSettings: unknown, property: string): unknown {
  const isNonObjectSettings = !isPlainObject(unparsedSettings);
  if (isNonObjectSettings) return null;

  return unparsedSettings[property];
}

function parseHookArray(hooksSetting: unknown[], origin: string): ParseHooksReport {
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
}

function parseHookObject(hooksSetting: Record<string, unknown>, origin: string): ParseHooksReport {
  const hooks: HookDefinition[] = [];
  const errors: string[] = [];

  for (const [eventName, field] of Object.entries(hooksSetting)) {
    errors.push(...parseHookEventHooks({ eventName, value: field, source: origin, hooks }));
  }

  return { hooks, errors };
}

interface ParseHookEventHooksDetails {
  eventName: string;
  value: unknown;
  source: string;
  hooks: HookDefinition[];
}

function parseHookEventHooks({
  eventName,
  value: field,
  source: origin,
  hooks,
}: ParseHookEventHooksDetails): string[] {
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
}

const HookFieldsSchema = z.object({
  event: z.enum(HOOK_LIFECYCLE_EVENTS),
  command: z.union([z.string(), z.array(z.string())]),
  // Only undefined is a missing name; an explicit null is an invalid name.
  name: z.string().optional(),
  // Only undefined is a missing flag; an explicit null is an invalid value.
  enabled: z.boolean().optional(),
});

const HOOK_FIELD_PROBLEMS: Record<string, string> = {
  event: "event must be a supported lifecycle event",
  command: "command must be a string or string array",
  name: "name must be a string",
  enabled: "enabled must be a boolean",
};

function readHookFieldProblem(origin: string, location: string, issue: z.core.$ZodIssue): string {
  const fieldName = String(issue.path[0]);
  return `${origin}: ${location}.${HOOK_FIELD_PROBLEMS[fieldName]}`;
}

function parseHookDefinition(
  unparsedHook: unknown,
  origin: string,
  location: string,
): HookParseReport {
  const hookFields = isPlainObject(unparsedHook) ? unparsedHook : {};
  const parsedFields = HookFieldsSchema.safeParse(hookFields);

  if (!parsedFields.success) {
    const errors = parsedFields.error.issues.map((issue) =>
      readHookFieldProblem(origin, location, issue),
    );
    return { errors };
  }

  const { event, command, name, enabled } = parsedFields.data;
  const hook: HookDefinition = { source: origin, event, command, name, enabled: enabled !== false };
  return { hook, errors: [] };
}

function readHookRunReport(event: HookLifecycleEvent, hook: HookDefinition): HookRunReport {
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
}
