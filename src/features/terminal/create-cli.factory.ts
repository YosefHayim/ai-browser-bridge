import { Command } from "commander";
import { registerCliCommands } from "./register-cli.ts";

/** Register and run the bridge CLI (TUI + headless subcommands). */
export async function runCli(argv: string[]): Promise<void> {
  const program = new Command();
  registerCliCommands(program);
  await program.parseAsync(argv);
}
