/** Default MCP server listen port. */
export const DEFAULT_MCP_PORT = 8765;

/** Default context window when model is unknown. */
export const DEFAULT_CONTEXT_LIMIT = 128_000;

/** Default permission mode for tool execution. */
export const DEFAULT_PERMISSION_MODE = "auto" as const;

/** Default ask timeout in seconds (headless). */
export const DEFAULT_ASK_TIMEOUT_SECONDS = 300;

/**
 * Milliseconds a render may make no visible progress before the wait loop reloads the tab
 * to re-sync the DOM with server truth. A stuck turn (lingering stop indicator, tiles that
 * never re-render) otherwise hangs to the full timeout; a reload surfaces the finished
 * output or the error instead. Progress (new text/image/network activity) resets the clock,
 * so a genuinely-streaming long render is never interrupted.
 */
export const RENDER_STALL_RELOAD_MS = 180_000;

/** Maximum tab reloads a single wait may trigger before falling through to the timeout. */
export const MAX_STALL_RELOADS = 2;
