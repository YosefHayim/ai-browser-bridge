import { Command } from "commander";
import { registerCliCommands } from "./registerCli.ts";

export const runCli = async (argv: string[]): Promise<void> => {
  const program = new Command();
  registerCliCommands(program);
  await program.parseAsync(argv);
};
