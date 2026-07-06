import type { Command as CommanderCommand } from "commander";

/**
 * Merge parent-program and subcommand options (Commander hoists shared flags to the root).
 *
 * @param command - Command value.
 * @returns The `subcommandOpts` result.
 * @example
 * ```ts
 * const result = subcommandOpts(command);
 * ```
 */
export const subcommandOpts = <T extends object>(command: CommanderCommand): T => {
  return { ...command.parent?.opts(), ...command.opts() } as T;
};
