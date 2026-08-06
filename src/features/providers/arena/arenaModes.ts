// Arena surface modes and entry URLs (LIVE-VERIFIED 2026-07-19).
// Mode combobox on arena.ai/code routes to battle / agent / side-by-side / direct.

export const ARENA_MODE_URLS = {
  battle: "https://arena.ai/code",
  agent: "https://arena.ai/agent",
  "side-by-side": "https://arena.ai/text/side-by-side",
  direct: "https://arena.ai/code/direct",
} as const;

export type ArenaMode = keyof typeof ARENA_MODE_URLS;

/** Combobox first-line labels for each mode. */
export const ARENA_MODE_LABELS = {
  battle: "Battle Mode",
  agent: "Agent Mode",
  "side-by-side": "Side by Side",
  direct: "Direct",
} as const;

/** CLI / --model tokens that switch mode rather than pick a model id. */
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

export const parseArenaMode = (raw: string): ArenaMode | undefined => {
  const normalizedToken = raw.trim().toLowerCase().replace(/\s+/g, "-");
  const mode = ARENA_MODE_ALIASES[normalizedToken];
  if (mode === undefined) return undefined;
  return mode;
};

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
