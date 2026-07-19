/**
 * Arena surface modes and their entry URLs (LIVE-VERIFIED 2026-07-19).
 *
 * The mode combobox on arena.ai/code exposes four options; selecting one routes to:
 * - Battle Mode → https://arena.ai/code (anonymous dual models + vote)
 * - Agent Mode → https://arena.ai/agent (agent shell; composer is contenteditable)
 * - Side by Side → https://arena.ai/text/side-by-side (pick two models)
 * - Direct → https://arena.ai/code/direct (single model; best default for the bridge)
 */

/** Canonical entry URL for each mode. */
export const ARENA_MODE_URLS = {
  battle: "https://arena.ai/code",
  agent: "https://arena.ai/agent",
  "side-by-side": "https://arena.ai/text/side-by-side",
  direct: "https://arena.ai/code/direct",
} as const;

/** Human labels shown in the mode combobox (first line of each option). */
export const ARENA_MODE_LABELS = {
  battle: "Battle Mode",
  agent: "Agent Mode",
  "side-by-side": "Side by Side",
  direct: "Direct",
} as const;

/** CLI / --model tokens that mean "switch mode" rather than pick a model id. */
export const ARENA_MODE_ALIASES: Record<string, ArenaMode> = {
  battle: "battle",
  "battle-mode": "battle",
  agent: "agent",
  "agent-mode": "agent",
  side: "side-by-side",
  "side-by-side": "side-by-side",
  sbs: "side-by-side",
  direct: "direct",
};

/** Supported Arena chat surface modes. */
export type ArenaMode = keyof typeof ARENA_MODE_URLS;

/**
 * Resolve a free-text token to an Arena mode, or null when it is a model id.
 *
 * @param raw - Raw value.
 * @returns The `parseArenaMode` result.
 * @example
 * ```ts
 * const result = parseArenaMode(raw);
 * ```
 */
export const parseArenaMode = (raw: string): ArenaMode | null => {
  const key = raw.trim().toLowerCase().replace(/\s+/g, "-");
  return ARENA_MODE_ALIASES[key] ?? null;
};

/**
 * Infer the active mode from the page URL.
 *
 * @param url - Url value.
 * @returns The `arenaModeFromUrl` result.
 * @example
 * ```ts
 * const result = arenaModeFromUrl(url);
 * ```
 */
export const arenaModeFromUrl = (url: string): ArenaMode => {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.includes("/agent")) return "agent";
    if (path.includes("side-by-side")) return "side-by-side";
    if (path.includes("/direct")) return "direct";
    return "battle";
  } catch {
    return "direct";
  }
};
