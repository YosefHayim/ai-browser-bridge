import { Command } from "commander";
import { writeCliFailure } from "./cli-failure.ts";
import type { ExitCode } from "./cli-types.ts";
import { registerCliCommands } from "./register-cli.ts";
import { runUntilInterrupt } from "./user-interrupt.ts";

// Commander throws instead of exiting, so every failure reaches this one boundary.
export const runCli = async (argv: string[]): Promise<ExitCode> => {
  const program = new Command().exitOverride();
  registerCliCommands(program);
  return runUntilInterrupt(() => runParsedCommand(program, argv));
};

const runParsedCommand = async (program: Command, argv: string[]): Promise<ExitCode> => {
  try {
    await program.parseAsync(argv);
    return 0;
  } catch (error) {
    return writeCliFailure(error);
  }
};
