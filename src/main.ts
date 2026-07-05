#!/usr/bin/env node
import { NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";
import { runCli } from "./features/terminal/index.ts";

/**
 * Application entrypoint.
 *
 * Wraps the CLI in NodeRuntime.runMain for proper signal handling (SIGINT/SIGTERM),
 * fiber interruption, and graceful shutdown. The CLI itself still uses Commander
 * internally — the full @effect/cli migration is a future pass.
 */
const program = Effect.tryPromise({
  try: () => runCli(process.argv),
  catch: (err) => err,
});

NodeRuntime.runMain(program);
