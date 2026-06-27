#!/usr/bin/env node
import { runCli } from "./features/terminal/create-cli.factory.ts";

runCli(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
