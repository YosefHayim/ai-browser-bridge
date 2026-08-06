#!/usr/bin/env node
import { runCli } from "./features/terminal/index.ts";

await runCli(process.argv);
