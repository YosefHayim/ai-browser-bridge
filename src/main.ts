#!/usr/bin/env node
import { runCli } from "@/terminal/cli.ts";

// process.exit drops writes a pipe has not taken yet, so wait until both streams are flushed.
const flushStream = (stream: NodeJS.WriteStream): Promise<void> => {
  return new Promise<void>((markFlushed) => {
    stream.write("", () => markFlushed());
  });
};

const exitCode = await runCli(process.argv);
await Promise.all([flushStream(process.stdout), flushStream(process.stderr)]);
process.exit(exitCode);
