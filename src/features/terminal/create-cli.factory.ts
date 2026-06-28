import { Command } from "commander";
import { CliRunner } from "./cli-runner.class.ts";
import { registerCliCommands } from "./register-cli.ts";

/** Register and run the bridge CLI (TUI + headless subcommands). */
export async function runCli(argv: string[]): Promise<void> {
  const runner = new CliRunner();
  const program = new Command();
  registerCliCommands(program, runner);
  await program.parseAsync(argv);
}
