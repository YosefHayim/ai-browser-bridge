const DIRECT_MODE = "direct";

const SIDE_BY_SIDE_MODE = "side-by-side";

const AGENT_MODE = "agent";

const BATTLE_MODE = "battle";
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
    battle: BATTLE_MODE,
    "battle-mode": BATTLE_MODE,
    agent: AGENT_MODE,
    "agent-mode": AGENT_MODE,
    side: SIDE_BY_SIDE_MODE,
    "side-by-side": SIDE_BY_SIDE_MODE,
    sbs: SIDE_BY_SIDE_MODE,
    direct: DIRECT_MODE,
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
    if (isAgentInPath) return AGENT_MODE;

    const isSideBySideInPath = path.includes(SIDE_BY_SIDE_MODE);
    if (isSideBySideInPath) return SIDE_BY_SIDE_MODE;

    const isDirectInPath = path.includes("/direct");
    if (isDirectInPath) return DIRECT_MODE;

    return BATTLE_MODE;
  } catch (error) {
    const isUrlInvalid = error instanceof TypeError;
    if (isUrlInvalid) return DIRECT_MODE;

    throw error;
  }
};
