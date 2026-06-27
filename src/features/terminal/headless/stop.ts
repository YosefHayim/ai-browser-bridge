import { BRIDGE_DEBUG_PORT } from "../../providers/chrome/browser-manager.ts";
import { killDebugPort } from "./shared.ts";

/** Close the warm Chrome instance holding the debug port. */
export async function runStop(): Promise<void> {
  const killed = await killDebugPort(BRIDGE_DEBUG_PORT);
  process.stderr.write(killed ? "Closed the bridge browser.\n" : "No bridge browser was running.\n");
  process.exit(0);
}
