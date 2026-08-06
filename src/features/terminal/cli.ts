import { Command } from "commander";
import { registerCliCommands } from "./registerCli.ts";

/**
 * Register and run the bridge CLI (TUI + headless subcommands).
 *
 * @param argv - Argv value.
 * @returns Completes when `runCli` finishes.
 * @example
 * ```ts
 * await runCli(argv);
 * ```
 */
export const runCli = async (argv: string[]): Promise<void> => {
  const program = new Command();
  registerCliCommands(program);
  await program.parseAsync(argv);
};
