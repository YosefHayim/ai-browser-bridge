import { spawn } from "node:child_process";
import { BrowserAttachError } from "./browser-attach.error.ts";
import { BRIDGE_DEBUG_PORT, CHROME_BIN } from "./browser-manager.constants.ts";

interface SpawnChromeInput {
  profileDir: string;
  defaultUrl: string;
}

/** Spawn a detached Chrome process with the bridge profile. */
export function spawnChrome(input: SpawnChromeInput): void {
  const child = spawn(CHROME_BIN, [
    `--user-data-dir=${input.profileDir}`,
    `--remote-debugging-port=${BRIDGE_DEBUG_PORT}`,
    "--no-first-run",
    "--no-default-browser-check",
    input.defaultUrl,
  ], { detached: true, stdio: "ignore" });
  child.unref();
}

/** Error when attach-only mode cannot find a debug listener. */
export function attachOnlyError(): BrowserAttachError {
  return new BrowserAttachError(
    `No Chrome listening on debug port ${BRIDGE_DEBUG_PORT}. Launch Chrome with --remote-debugging-port=9222 or run \`bridge login\`.`,
  );
}

/** Error when Chrome is running without the bridge debug port. */
export function chromeAlreadyRunningError(): BrowserAttachError {
  return new BrowserAttachError(
    "Chrome is already running without the bridge debug port. The bridge will not open a second window.",
  );
}

/** Error when spawned Chrome never exposes the debug port. */
export function spawnReadyError(): BrowserAttachError {
  return new BrowserAttachError(`Chrome started but debug port ${BRIDGE_DEBUG_PORT} did not become ready.`);
}
