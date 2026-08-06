import type { Command } from "commander";

/** Merge parent-program and subcommand options (Commander hoists shared flags to the root). */
export const subcommandOpts = <T extends object>(command: Command): T => {
  return { ...command.parent?.opts(), ...command.opts() } as T;
};
