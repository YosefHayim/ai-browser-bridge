import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { hasErrorCode } from "@/features/domain";
import { HOOKS_FILE, homeHooksPath } from "@/features/store";

export const HOOK_LIFECYCLE_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SessionEnd",
] as const;

export type HookLifecycleEvent = (typeof HOOK_LIFECYCLE_EVENTS)[number];
export type HookCommand = string | readonly string[];
export type HookRunStatus = "skipped" | "disabled";

export type HookDefinition = {
  readonly source: string;
  readonly event: HookLifecycleEvent;
  readonly command: HookCommand;
  readonly name?: string;
  readonly enabled: boolean;
};

export type ParseHooksResult = {
  readonly hooks: HookDefinition[];
  readonly errors: string[];
};

export type LoadHooksOptions = {
  readonly repoRoot: string;
  readonly homeDir?: string;
};

export type LoadedHooksConfig = ParseHooksResult & {
  readonly paths: string[];
};

export type HookRunResult = {
  readonly event: HookLifecycleEvent;
  readonly command: HookCommand;
  readonly status: HookRunStatus;
  readonly reason: "hook-command-execution-disabled" | "hook-disabled";
};

type RawHookFields = {
  event?: unknown;
  command?: unknown;
  name?: unknown;
  enabled?: unknown;
};

type HookEntryParse = {
  readonly hook?: HookDefinition;
  readonly errors: string[];
};

export const isHookLifecycleEvent = (value: string): value is HookLifecycleEvent => {
  return (HOOK_LIFECYCLE_EVENTS as readonly string[]).includes(value);
};

export const hookConfigPaths = (repoRoot: string, homeDir = homedir()): string[] => {
  return [join(repoRoot, ".bridge", HOOKS_FILE), homeHooksPath(homeDir)];
};

export const parseHooksConfig = (rawConfig: unknown, source = "inline"): ParseHooksResult => {
  const hooksValue = readObjectProperty(rawConfig, "hooks");
  if (Array.isArray(hooksValue)) {
    return parseHookArray(hooksValue, source);
  }
  if (isRecord(hooksValue)) {
    return parseHookObject(hooksValue, source);
  }
  return { hooks: [], errors: [`${source}: hooks must be an array or object`] };
};

// Shell command execution is intentionally disabled; outcomes report skip/disabled only.
export const runHooks = async (
  event: HookLifecycleEvent,
  hooks: readonly HookDefinition[],
): Promise<HookRunResult[]> => {
  const outcomes: HookRunResult[] = [];
  for (const hook of hooks) {
    if (hook.event !== event) continue;
    outcomes.push(hookRunOutcome(event, hook));
  }
  return outcomes;
};

export const loadHooksConfig = async (options: LoadHooksOptions): Promise<LoadedHooksConfig> => {
  const paths = hookConfigPaths(options.repoRoot, options.homeDir);
  const hooks: HookDefinition[] = [];
  const errors: string[] = [];
  for (const path of paths) {
    const parsedFile = await readHookFile(path);
    if (parsedFile === undefined) continue;
    hooks.push(...parsedFile.hooks);
    errors.push(...parsedFile.errors);
  }
  return { paths, hooks, errors };
};

const readHookFile = async (path: string): Promise<ParseHooksResult | undefined> => {
  let text: string;
  try {
    text = await readFile(path, "utf-8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
  try {
    return parseHooksConfig(JSON.parse(text), path);
  } catch (error) {
    return { hooks: [], errors: [`${path}: invalid JSON (${errorMessage(error)})`] };
  }
};

const isHookCommand = (value: unknown): value is HookCommand => {
  if (typeof value === "string") return true;
  if (!Array.isArray(value)) return false;
  return value.every((part) => typeof part === "string");
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const readObjectProperty = (rawConfig: unknown, property: string): unknown => {
  if (!isRecord(rawConfig)) return undefined;
  return rawConfig[property];
};

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

const parseHookArray = (hooksValue: unknown[], source: string): ParseHooksResult => {
  const hooks: HookDefinition[] = [];
  const errors: string[] = [];
  for (let index = 0; index < hooksValue.length; index += 1) {
    const parsed = parseHookEntry(hooksValue[index], source, String(index));
    if (parsed.hook !== undefined) hooks.push(parsed.hook);
    errors.push(...parsed.errors);
  }
  return { hooks, errors };
};

const parseHookObject = (hooksValue: Record<string, unknown>, source: string): ParseHooksResult => {
  const hooks: HookDefinition[] = [];
  const errors: string[] = [];
  for (const [eventName, value] of Object.entries(hooksValue)) {
    errors.push(...parseHookEventHooks(eventName, value, source, hooks));
  }
  return { hooks, errors };
};

const parseHookEventHooks = (
  eventName: string,
  value: unknown,
  source: string,
  hooks: HookDefinition[],
): string[] => {
  if (!isHookLifecycleEvent(eventName)) {
    return [`${source}: unsupported hook event ${eventName}`];
  }
  if (!Array.isArray(value)) {
    return [`${source}: ${eventName} must be an array`];
  }
  const errors: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    const fields = isRecord(entry) ? { ...entry, event: eventName } : { event: eventName };
    const parsed = parseHookEntry(fields, source, `${eventName}[${index}]`);
    if (parsed.hook !== undefined) hooks.push(parsed.hook);
    errors.push(...parsed.errors);
  }
  return errors;
};

const parseHookEntry = (rawEntry: unknown, source: string, location: string): HookEntryParse => {
  const fields = readHookFields(rawEntry);
  const errors = validateHookFields(fields, source, location);
  if (errors.length > 0) return { errors };
  if (typeof fields.event !== "string" || !isHookLifecycleEvent(fields.event)) {
    return { errors };
  }
  if (!isHookCommand(fields.command)) return { errors };

  let name: string | undefined;
  if (typeof fields.name === "string") name = fields.name;

  let enabled = true;
  if (fields.enabled === false) enabled = false;

  return {
    hook: {
      source,
      event: fields.event,
      command: fields.command,
      name,
      enabled,
    },
    errors,
  };
};

const readHookFields = (rawEntry: unknown): RawHookFields => {
  if (!isRecord(rawEntry)) return {};
  return {
    event: rawEntry.event,
    command: rawEntry.command,
    name: rawEntry.name,
    enabled: rawEntry.enabled,
  };
};

const validateHookFields = (fields: RawHookFields, source: string, location: string): string[] => {
  const errors: string[] = [];
  if (typeof fields.event !== "string" || !isHookLifecycleEvent(fields.event)) {
    errors.push(`${source}: ${location}.event must be a supported lifecycle event`);
  }
  if (!isHookCommand(fields.command)) {
    errors.push(`${source}: ${location}.command must be a string or string array`);
  }
  if (fields.name !== undefined && typeof fields.name !== "string") {
    errors.push(`${source}: ${location}.name must be a string`);
  }
  if (fields.enabled !== undefined && typeof fields.enabled !== "boolean") {
    errors.push(`${source}: ${location}.enabled must be a boolean`);
  }
  return errors;
};

const hookRunOutcome = (event: HookLifecycleEvent, hook: HookDefinition): HookRunResult => {
  if (!hook.enabled) {
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
