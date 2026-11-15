import { Command } from "commander";
import { writeCliFailure } from "@/terminal/cli-failure.ts";
import type { ExitCode } from "@/terminal/cli-types.ts";
import { registerCliCommands } from "@/terminal/register-cli.ts";
import { runUntilInterrupt } from "@/terminal/user-interrupt.ts";

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
