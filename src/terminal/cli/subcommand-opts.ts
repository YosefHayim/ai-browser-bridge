import type { Command } from "commander";

// Commander hoists shared flags to the root; merge parent + leaf opts.
export function readSubcommandSettings<T extends object>(command: Command): T {
  return { ...command.parent?.opts(), ...command.opts() };
}
