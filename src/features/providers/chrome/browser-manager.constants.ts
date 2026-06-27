/** Chrome remote-debugging port the bridge attaches to / spawns on. */
export const BRIDGE_DEBUG_PORT = 9222;

/** macOS Google Chrome binary path. */
export const CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** CDP endpoint for the bridge debug port. */
export const CDP_URL = `http://localhost:${BRIDGE_DEBUG_PORT}`;
