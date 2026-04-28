export type ModelProvider = "openai" | "anthropic" | "zai" | "unknown";

export interface ModelProfile {
  id: string;
  label: string;
  provider: ModelProvider;
  aliases: string[];
  contextWindow: number;
  maxOutputTokens?: number;
  sourceUrl: string;
  note?: string;
}

const OPENAI_MODELS_URL = "https://platform.openai.com/docs/models";
const OPENAI_GPT_5_2_CHAT_URL = "https://platform.openai.com/docs/models/gpt-5.2-chat-latest";
const OPENAI_GPT_5_2_URL = "https://platform.openai.com/docs/models/gpt-5.2";
const OPENAI_GPT_4_1_URL = "https://platform.openai.com/docs/models/gpt-4.1";
const OPENAI_GPT_4O_URL = "https://platform.openai.com/docs/models/gpt-4o";
const ANTHROPIC_MODELS_URL = "https://docs.anthropic.com/en/docs/models-overview";
const ANTHROPIC_CONTEXT_URL = "https://docs.anthropic.com/en/docs/build-with-claude/context-windows";
const ZAI_MODELS_URL = "https://docs.z.ai/guides/overview/overview";
const ZAI_GLM_5_1_URL = "https://docs.z.ai/guides/llm/glm-5.1";

export const UNKNOWN_MODEL_PROFILE: ModelProfile = {
  id: "unknown-chatgpt",
  label: "ChatGPT",
  provider: "unknown",
  aliases: ["chatgpt", "auto"],
  contextWindow: 128_000,
  maxOutputTokens: 16_384,
  sourceUrl: OPENAI_MODELS_URL,
  note: "Fallback for browser-detected models that do not expose a stable model id.",
};

export const MODEL_PROFILES: ModelProfile[] = [
  {
    id: "gpt-5.5-pro",
    label: "GPT-5.5 Pro",
    provider: "openai",
    aliases: ["gpt-5.5 pro", "gpt 5.5 pro", "pro", "model-switcher-gpt-5-5-pro"],
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    sourceUrl: "https://platform.openai.com/docs/models",
    note: "ChatGPT browser UI label observed from the model picker; exact API alias is not published as a standalone model page.",
  },
  {
    id: "gpt-5.5-thinking",
    label: "GPT-5.5 Thinking",
    provider: "openai",
    aliases: ["gpt-5.5 thinking", "gpt 5.5 thinking", "thinking", "model-switcher-gpt-5-5-thinking"],
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    sourceUrl: "https://platform.openai.com/docs/models",
    note: "ChatGPT browser UI label observed from the model picker; exact API alias is not published as a standalone model page.",
  },
  {
    id: "gpt-5.3-instant",
    label: "GPT-5.3 Instant",
    provider: "openai",
    aliases: ["gpt-5.3 instant", "gpt 5.3 instant", "instant", "model-switcher-gpt-5-3"],
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    sourceUrl: "https://platform.openai.com/docs/models",
    note: "ChatGPT browser UI label observed from the model picker; exact API alias is not published as a standalone model page.",
  },
  {
    id: "gpt-5.2-chat-latest",
    label: "GPT-5.2 Chat",
    provider: "openai",
    aliases: ["gpt-5.2", "gpt 5.2", "gpt-5.2 chat", "chatgpt gpt-5.2", "gpt-5-2"],
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    sourceUrl: OPENAI_GPT_5_2_CHAT_URL,
    note: "ChatGPT browser model alias, not the larger API flagship context.",
  },
  {
    id: "gpt-5.2",
    label: "GPT-5.2 API",
    provider: "openai",
    aliases: ["api:gpt-5.2", "gpt-5.2 api", "openai gpt-5.2"],
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    sourceUrl: OPENAI_GPT_5_2_URL,
  },
  {
    id: "gpt-5.1-chat-latest",
    label: "GPT-5.1 Chat",
    provider: "openai",
    aliases: ["gpt-5.1", "gpt 5.1", "gpt-5.1 chat", "chatgpt gpt-5.1", "gpt-5-1"],
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    sourceUrl: "https://platform.openai.com/docs/models/gpt-5.1-chat-latest",
  },
  {
    id: "gpt-5-chat-latest",
    label: "GPT-5 Chat",
    provider: "openai",
    aliases: ["gpt-5", "gpt 5", "gpt-5 chat", "chatgpt gpt-5", "gpt-5-0"],
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    sourceUrl: "https://platform.openai.com/docs/models/gpt-5-chat-latest",
  },
  {
    id: "gpt-4.1",
    label: "GPT-4.1 API",
    provider: "openai",
    aliases: ["api:gpt-4.1", "gpt-4.1 api", "openai gpt-4.1"],
    contextWindow: 1_047_576,
    maxOutputTokens: 32_768,
    sourceUrl: OPENAI_GPT_4_1_URL,
  },
  {
    id: "gpt-4o",
    label: "GPT-4o",
    provider: "openai",
    aliases: ["gpt 4o", "4o", "chatgpt-4o", "chatgpt 4o"],
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    sourceUrl: OPENAI_GPT_4O_URL,
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o Mini",
    provider: "openai",
    aliases: ["gpt 4o mini", "4o mini", "gpt-4o-mini"],
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    sourceUrl: "https://platform.openai.com/docs/models/gpt-4o-mini",
  },
  {
    id: "gpt-4",
    label: "GPT-4",
    provider: "openai",
    aliases: ["gpt 4"],
    contextWindow: 8_192,
    maxOutputTokens: 8_192,
    sourceUrl: "https://platform.openai.com/docs/models/gpt-4",
  },
  {
    id: "o4-mini",
    label: "o4-mini",
    provider: "openai",
    aliases: ["o4 mini", "o4mini"],
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    sourceUrl: "https://platform.openai.com/docs/models/o4-mini",
  },
  {
    id: "claude-4",
    label: "Claude 4 family",
    provider: "anthropic",
    aliases: ["claude", "claude sonnet", "claude sonnet 4", "claude opus 4", "claude opus 4.1"],
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    sourceUrl: ANTHROPIC_MODELS_URL,
    note: "Anthropic lists 200K for current Claude text models; Sonnet 4 has a 1M beta on eligible API tiers.",
  },
  {
    id: "claude-sonnet-4-1m-beta",
    label: "Claude Sonnet 4 1M beta",
    provider: "anthropic",
    aliases: ["claude 1m", "sonnet 1m", "claude sonnet 4 1m", "sonnet[1m]"],
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    sourceUrl: ANTHROPIC_CONTEXT_URL,
    note: "Beta requires the context-1m-2025-08-07 header and eligible organization tier.",
  },
  {
    id: "glm-5.1",
    label: "GLM-5.1",
    provider: "zai",
    aliases: ["z.ai", "zai", "glm", "glm-5.1", "glm 5.1"],
    contextWindow: 200_000,
    maxOutputTokens: 128_000,
    sourceUrl: ZAI_GLM_5_1_URL,
  },
  {
    id: "glm-5",
    label: "GLM-5",
    provider: "zai",
    aliases: ["glm-5", "glm 5"],
    contextWindow: 200_000,
    sourceUrl: ZAI_MODELS_URL,
  },
  {
    id: "glm-4.5",
    label: "GLM-4.5",
    provider: "zai",
    aliases: ["glm-4.5", "glm 4.5", "glm-4.5-air", "glm 4.5 air"],
    contextWindow: 128_000,
    maxOutputTokens: 96_000,
    sourceUrl: "https://docs.z.ai/guides/llm/glm-4.5",
  },
];

function normalizeModelKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/chatgpt/g, "chatgpt ")
    .replace(/[^a-z0-9.:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function modelKeys(profile: ModelProfile): string[] {
  return [profile.id, profile.label, ...profile.aliases].map(normalizeModelKey);
}

export function findModelProfile(modelName: string | undefined): ModelProfile {
  if (!modelName?.trim()) return UNKNOWN_MODEL_PROFILE;

  const query = normalizeModelKey(modelName);
  if (modelKeys(UNKNOWN_MODEL_PROFILE).includes(query)) {
    return UNKNOWN_MODEL_PROFILE;
  }

  for (const profile of MODEL_PROFILES) {
    if (modelKeys(profile).includes(query)) return profile;
  }

  return { ...UNKNOWN_MODEL_PROFILE, label: modelName.trim() };
}

export function listModelProfiles(): ModelProfile[] {
  return [...MODEL_PROFILES];
}
