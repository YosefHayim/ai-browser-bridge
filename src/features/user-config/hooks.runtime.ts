import { readFile } from "node:fs/promises";
import { hasErrorCode } from "../domain/errors.ts";
import { errorMessage } from "./hooks.helpers.ts";
import { parseHooksConfig } from "./hooks.parse.ts";
import { hookConfigPaths } from "./hooks.helpers.ts";
import type { HookDefinition, HookLifecycleEvent, HookRunResult, LoadedHooksConfig, LoadHooksOptions } from "./hooks.types.ts";

/** Load local and user hook configs, collecting validation errors. */
export async function loadHooksConfig(options: LoadHooksOptions): Promise<LoadedHooksConfig> {
  const paths = hookConfigPaths(options.repoRoot, options.homeDir);
  const hooks: HookDefinition[] = [];
  const errors: string[] = [];
  for (const path of paths) {
    const loaded = await readHookFile(path);
    if (!loaded) continue;
    hooks.push(...loaded.hooks);
    errors.push(...loaded.errors);
  }
  return { paths, hooks, errors };
}

async function readHookFile(path: string) {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw error;
  }
  try {
    return parseHooksConfig({ raw: JSON.parse(raw), source: path });
  } catch (error) {
    return { hooks: [], errors: [`${path}: invalid JSON (${errorMessage(error)})`] };
  }
}

interface RunHooksInput {
  /** Lifecycle event to evaluate. */
  event: HookLifecycleEvent;
  /** Loaded hook definitions. */
  hooks: readonly HookDefinition[];
}

/** Run hooks for an event without executing shell commands yet. */
export async function runHooks(input: RunHooksInput | HookLifecycleEvent, hooks?: readonly HookDefinition[]): Promise<HookRunResult[]> {
  const event = typeof input === "string" ? input : input.event;
  const definitions = typeof input === "string" ? hooks ?? [] : input.hooks;
  return definitions.filter((hook) => hook.event === event).map((hook) => mapHookRun({ event, hook }));
}

function mapHookRun(input: { event: HookLifecycleEvent; hook: HookDefinition }): HookRunResult {
  if (!input.hook.enabled) {
    return { event: input.event, command: input.hook.command, status: "disabled", reason: "hook-disabled" };
  }
  return { event: input.event, command: input.hook.command, status: "skipped", reason: "hook-command-execution-disabled" };
}
