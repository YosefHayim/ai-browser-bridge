import { Command } from "commander";
import { writeCliFailure } from "./cli-failure.ts";
import { registerCliCommands } from "./register-cli.ts";

export const runCli = async (argv: string[]): Promise<void> => {
  const program = new Command();
  registerCliCommands(program);
  try {
    await program.parseAsync(argv);
  } catch (error) {
    writeCliFailure(error);
  }
};
