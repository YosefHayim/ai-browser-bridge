import { homedir } from "node:os";
import { join } from "node:path";
import { HOOKS_FILE, homeHooksPath } from "../store/paths.ts";
import { HOOK_LIFECYCLE_EVENTS, type HookLifecycleEvent } from "./hooks.types.ts";

interface HookConfigPathsInput {
  /** Repo root whose `.bridge/hooks.json` is searched first. */
  repoRoot: string;
  /** Optional home directory override. */
  homeDir?: string;
}

/** Return hook config search paths in deterministic load order. */
export function hookConfigPaths(input: HookConfigPathsInput | string, homeDir = homedir()): string[] {
  const repoRoot = typeof input === "string" ? input : input.repoRoot;
  const home = typeof input === "string" ? homeDir : input.homeDir ?? homedir();
  return [join(repoRoot, ".bridge", HOOKS_FILE), homeHooksPath(home)];
}

/** Whether a string is a supported hook lifecycle event. */
export function isHookLifecycleEvent(value: string): value is HookLifecycleEvent {
  return (HOOK_LIFECYCLE_EVENTS as readonly string[]).includes(value);
}

/** Whether a value is a supported hook command shape. */
export function isHookCommand(value: unknown): value is string | readonly string[] {
  return typeof value === "string"
    || (Array.isArray(value) && value.every((part) => typeof part === "string"));
}

/** Whether a value is a plain object record. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Convert unknown JSON into a record, defaulting to empty. */
export function asRecord(raw: unknown): Record<string, unknown> {
  return isRecord(raw) ? raw : {};
}

/** Read one property from a record-like JSON value. */
export function readObjectProperty(raw: unknown, property: string): unknown {
  if (!isRecord(raw)) return undefined;
  return raw[property];
}

/** Format an unknown thrown value as a message string. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
