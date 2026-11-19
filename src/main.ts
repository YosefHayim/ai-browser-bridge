#!/usr/bin/env node
import { readErrorMessage } from "@/read-error-message.ts";
import { runCli } from "@/terminal/cli/cli.ts";

// process.exit drops writes a pipe has not taken yet, so wait until both streams are flushed.
function flushStream(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise<void>((markFlushed) => {
    stream.write("", () => markFlushed());
  });
}

async function runMain(): Promise<number> {
  try {
    return await runCli(process.argv);
  } catch (error) {
    process.stderr.write(`${readErrorMessage(error)}\n`);
    return 1;
  }
}

const exitCode = await runMain();
await Promise.all([flushStream(process.stdout), flushStream(process.stderr)]);
process.exit(exitCode);
