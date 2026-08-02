#!/usr/bin/env node
import { NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";
import { runCli } from "./features/terminal/index.ts";

/**
 * Application entrypoint.
 *
 * Wraps the CLI in NodeRuntime.runMain for proper signal handling (SIGINT/SIGTERM),
 * fiber interruption, and graceful shutdown. The CLI itself still uses Commander
 * internally; any future Effect-native CLI migration should add its framework in
 * the same change that implements it.
 */
const program = Effect.tryPromise({
  try: () => runCli(process.argv),
  catch: (err) => err,
});

NodeRuntime.runMain(program);
