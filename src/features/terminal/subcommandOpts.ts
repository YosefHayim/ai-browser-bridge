import type { Command as CommanderCommand } from "commander";

/** Merge parent-program and subcommand options (Commander hoists shared flags to the root). */
export function subcommandOpts<T extends object>(command: CommanderCommand): T {
  return { ...command.parent?.opts(), ...command.opts() } as T;
}
