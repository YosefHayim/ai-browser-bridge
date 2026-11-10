export const ARENA_MODE_URLS = {
  battle: "https://arena.ai/code",
  agent: "https://arena.ai/agent",
  "side-by-side": "https://arena.ai/text/side-by-side",
  direct: "https://arena.ai/code/direct",
} as const;

export type ArenaMode = keyof typeof ARENA_MODE_URLS;

export const ARENA_MODE_LABELS = {
  battle: "Battle Mode",
  agent: "Agent Mode",
  "side-by-side": "Side by Side",
  direct: "Direct",
} as const;

export const parseArenaMode = (unparsed: string): ArenaMode | null => {
  const normalizedToken = unparsed.trim().toLowerCase().replace(/\s+/g, "-");
  const modeByToken: Record<string, ArenaMode> = {
    battle: "battle",
    "battle-mode": "battle",
    agent: "agent",
    "agent-mode": "agent",
    side: "side-by-side",
    "side-by-side": "side-by-side",
    sbs: "side-by-side",
    direct: "direct",
  };
  const mode = modeByToken[normalizedToken];

  const isModeMissing = mode == null;
  if (isModeMissing) return null;

  return mode;
};

export const readArenaModeFromUrl = (url: string): ArenaMode => {
  try {
    const path = new URL(url).pathname.toLowerCase();

    const isAgentInPath = path.includes("/agent");
    if (isAgentInPath) return "agent";

    const isSideBySideInPath = path.includes("side-by-side");
    if (isSideBySideInPath) return "side-by-side";

    const isDirectInPath = path.includes("/direct");
    if (isDirectInPath) return "direct";

    return "battle";
  } catch (error) {
    const isUrlInvalid = error instanceof TypeError;
    if (isUrlInvalid) return "direct";

    throw error;
  }
};
