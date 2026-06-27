/** Chrome remote-debugging port the bridge attaches to / spawns on. */
export const BRIDGE_DEBUG_PORT = 9222;

/** macOS Google Chrome binary path. */
export const CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** CDP endpoint for the bridge debug port (127.0.0.1 avoids IPv6 ::1 refusal on macOS). */
export const CDP_URL = `http://127.0.0.1:${BRIDGE_DEBUG_PORT}`;
