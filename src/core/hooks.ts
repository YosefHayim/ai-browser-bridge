import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

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

export interface HookDefinition {
  source: string;
  event: HookLifecycleEvent;
  command: HookCommand;
  name?: string;
  enabled: boolean;
}

export interface ParseHooksResult {
  hooks: HookDefinition[];
  errors: string[];
}

export interface LoadHooksOptions {
  repoRoot: string;
  homeDir?: string;
}

export interface LoadedHooksConfig extends ParseHooksResult {
  paths: string[];
}

export type HookRunStatus = "skipped" | "disabled";

export interface HookRunResult {
  event: HookLifecycleEvent;
  command: HookCommand;
  status: HookRunStatus;
  reason: "hook-command-execution-disabled" | "hook-disabled";
}

interface RawHookFields {
  event?: unknown;
  command?: unknown;
  name?: unknown;
  enabled?: unknown;
}

/** Return hook config search paths in deterministic load order. */
export function hookConfigPaths(repoRoot: string, homeDir = homedir()): string[] {
  return [
    join(repoRoot, ".bridge", "hooks.json"),
    join(homeDir, ".chatgpt-bridge", "hooks.json"),
  ];
}

export function isHookLifecycleEvent(value: string): value is HookLifecycleEvent {
  return (HOOK_LIFECYCLE_EVENTS as readonly string[]).includes(value);
}

/** Parse and validate a hooks.json payload without executing anything. */
export function parseHooksConfig(raw: unknown, source = "inline"): ParseHooksResult {
  const hooksValue = readObjectProperty(raw, "hooks");
  const hooks: HookDefinition[] = [];
  const errors: string[] = [];

  if (Array.isArray(hooksValue)) {
    hooksValue.forEach((hook, index) => {
      const parsed = parseHookEntry(hook, source, String(index));
      if (parsed.hook) hooks.push(parsed.hook);
      errors.push(...parsed.errors);
    });
    return { hooks, errors };
  }

  if (isRecord(hooksValue)) {
    for (const [eventName, value] of Object.entries(hooksValue)) {
      if (!isHookLifecycleEvent(eventName)) {
        errors.push(`${source}: unsupported hook event ${eventName}`);
        continue;
      }

      if (!Array.isArray(value)) {
        errors.push(`${source}: ${eventName} must be an array`);
        continue;
      }

      value.forEach((hook, index) => {
        const parsed = parseHookEntry({ ...asRecord(hook), event: eventName }, source, `${eventName}[${index}]`);
        if (parsed.hook) hooks.push(parsed.hook);
        errors.push(...parsed.errors);
      });
    }
    return { hooks, errors };
  }

  errors.push(`${source}: hooks must be an array or object`);
  return { hooks, errors };
}

/** Load local and user hook configs, collecting validation errors. */
export async function loadHooksConfig(options: LoadHooksOptions): Promise<LoadedHooksConfig> {
  const paths = hookConfigPaths(options.repoRoot, options.homeDir);
  const hooks: HookDefinition[] = [];
  const errors: string[] = [];

  for (const path of paths) {
    let raw: string;
    try {
      raw = await readFile(path, "utf-8");
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) continue;
      throw error;
    }

    try {
      const parsed = parseHooksConfig(JSON.parse(raw), path);
      hooks.push(...parsed.hooks);
      errors.push(...parsed.errors);
    } catch (error) {
      errors.push(`${path}: invalid JSON (${errorMessage(error)})`);
    }
  }

  return { paths, hooks, errors };
}

/**
 * Run hooks for an event.
 *
 * Command execution is intentionally disabled until the CLI can provide a
 * confirmation and allowlist flow for hook commands.
 */
export async function runHooks(
  event: HookLifecycleEvent,
  hooks: readonly HookDefinition[],
): Promise<HookRunResult[]> {
  return hooks
    .filter((hook) => hook.event === event)
    .map((hook) => {
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
    });
}

function parseHookEntry(
  raw: unknown,
  source: string,
  location: string,
): { hook?: HookDefinition; errors: string[] } {
  const fields = readHookFields(raw);
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

  if (errors.length > 0 || typeof fields.event !== "string" || !isHookLifecycleEvent(fields.event)) {
    return { errors };
  }

  if (!isHookCommand(fields.command)) {
    return { errors };
  }

  return {
    hook: {
      source,
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
  return {
    event: raw.event,
    command: raw.command,
    name: raw.name,
    enabled: raw.enabled,
  };
}

function isHookCommand(value: unknown): value is HookCommand {
  return (
    typeof value === "string" ||
    (Array.isArray(value) && value.every((part) => typeof part === "string"))
  );
}

function readObjectProperty(raw: unknown, property: string): unknown {
  if (!isRecord(raw)) return undefined;
  return raw[property];
}

function asRecord(raw: unknown): Record<string, unknown> {
  return isRecord(raw) ? raw : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
