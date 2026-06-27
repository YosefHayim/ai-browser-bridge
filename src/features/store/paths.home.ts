import { homedir } from "node:os";
import { join } from "node:path";
import { BRIDGE_DIR_NAME, HOOKS_FILE } from "./paths.constants.ts";

/** Absolute machine-global bridge home for a given OS home directory. */
export function bridgeHome(home = homedir()): string {
  return join(home, BRIDGE_DIR_NAME);
}

/** Path to the user-level hooks config, honouring an injected home dir for tests. */
export function homeHooksPath(home = homedir()): string {
  return join(bridgeHome(home), HOOKS_FILE);
}
