import { Command } from "commander";
import { CliRunner } from "./internal/cliRunner.ts";
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
  const runner = new CliRunner();
  const program = new Command();
  registerCliCommands(program, runner);
  await program.parseAsync(argv);
};
