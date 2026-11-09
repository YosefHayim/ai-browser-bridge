#!/usr/bin/env node
import { runCli } from "@/features/cli/cli.ts";

await runCli(process.argv);
