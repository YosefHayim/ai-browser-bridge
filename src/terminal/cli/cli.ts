import { Command } from "commander";
import { writeCliFailure } from "@/terminal/cli/cli-failure.ts";
import type { ExitCode } from "@/terminal/cli/cli-types.ts";
import { registerCliCommands } from "@/terminal/cli/register-cli.ts";
import { runUntilInterrupt } from "@/terminal/cli/user-interrupt.ts";

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
