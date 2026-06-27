import type { CommandDef, CommandContext } from "../../domain/types.ts";
import { BUILTIN_COMMANDS } from "./builtins.ts";
import {
  executeBuiltinCommand,
  executeCustomCommand,
  parseCommandInput,
} from "./registry.helpers.ts";

/**
 * Slash-command dispatch: the registry Map plus lookup/execution. The actual
 * command catalog lives in `builtins.ts` and `commands.config.ts` (imported
 * below) and custom user
 * commands are resolved on demand from markdown files. Importing this module
 * registers all built-ins as a side effect, so consumers only need to import
 * {@link executeCommand} / {@link getAllCommands} to get a working command set.
 */

const commands = new Map<string, CommandDef>();
const canonicalNames = new Set<string>();

/** Register a command under its name and any aliases. */
export function registerCommand(cmd: CommandDef): void {
  commands.set(cmd.name, cmd);
  canonicalNames.add(cmd.name);
  for (const alias of cmd.aliases ?? []) {
    commands.set(alias, cmd);
  }
}

/** Get all registered, non-hidden commands (for autocomplete and `/help`). */
export function getAllCommands(): CommandDef[] {
  return [...canonicalNames]
    .map((name) => commands.get(name))
    .filter((cmd): cmd is CommandDef => !!cmd && !cmd.hidden);
}

/** Parse input as a registered command, or null if it is not a known command string. */
export function parseCommand(input: string): { name: string; args: string } | null {
  const parsed = parseCommandInput(input);
  if (!parsed || !commands.has(parsed.name)) return null;
  return parsed;
}

/**
 * Execute a command, returning true if the input was handled.
 *
 * Falls back to project/user custom commands (markdown templates) when the name
 * is not a built-in, and reports handler errors without throwing.
 */
export async function executeCommand(
  input: string,
  ctx: CommandContext,
): Promise<boolean> {
  const parsed = parseCommandInput(input);
  if (!parsed) return false;
  const cmd = commands.get(parsed.name);
  if (!cmd) return executeCustomCommand({ parsed, ctx });
  return executeBuiltinCommand({ parsed, cmd, ctx });
}

/** Filter commands whose name starts with the partial text after the `/`. */
export function matchCommands(partial: string): CommandDef[] {
  const q = partial.toLowerCase();
  return getAllCommands().filter((cmd) => cmd.name.toLowerCase().startsWith(q));
}

for (const command of BUILTIN_COMMANDS) {
  registerCommand(command);
}
