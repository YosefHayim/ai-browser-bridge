import type { ModelProfile } from "./modelProfileTypes.ts";
import { OPENAI_GPT_4O_URL, OPENAI_GPT_4_1_URL } from "./modelUrls.ts";
import { OPENAI_GPT5_MODEL_PROFILES } from "./openaiGpt5Profiles.ts";

/** GPT-4.x and o-series OpenAI model profiles. */
export const OPENAI_LEGACY_MODEL_PROFILES: ModelProfile[] = [
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
];

/** OpenAI and ChatGPT browser model profiles. */
export const OPENAI_MODEL_PROFILES: ModelProfile[] = [
  ...OPENAI_GPT5_MODEL_PROFILES,
  ...OPENAI_LEGACY_MODEL_PROFILES,
];
