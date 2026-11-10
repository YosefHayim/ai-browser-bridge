import type { ModelProfile } from "./model-profile-types.ts";
import { OPENAI_GPT_4_1_URL, OPENAI_GPT_4O_URL } from "./model-urls.ts";
import { OPENAI_GPT5_MODEL_PROFILES } from "./openai-gpt5-profiles.ts";

const OPENAI_MAX_GENERATED_TOKENS = 16_384;

const O4_MINI_MODEL_ID = "o4-mini";

const GPT_4O_MINI_MODEL_ID = "gpt-4o-mini";

const OPENAI_PROVIDER_ID = "openai";

const OPENAI_LEGACY_MODEL_PROFILES: ModelProfile[] = [
  {
    id: "gpt-4.1",
    label: "GPT-4.1 API",
    provider: OPENAI_PROVIDER_ID,
    aliases: ["api:gpt-4.1", "gpt-4.1 api", "openai gpt-4.1"],
    contextWindow: 1_047_576,
    maxOutputTokens: 32_768,
    sourceUrl: OPENAI_GPT_4_1_URL,
  },
  {
    id: "gpt-4o",
    label: "GPT-4o",
    provider: OPENAI_PROVIDER_ID,
    aliases: ["gpt 4o", "4o", "chatgpt-4o", "chatgpt 4o"],
    contextWindow: 128_000,
    maxOutputTokens: OPENAI_MAX_GENERATED_TOKENS,
    sourceUrl: OPENAI_GPT_4O_URL,
  },
  {
    id: GPT_4O_MINI_MODEL_ID,
    label: "GPT-4o Mini",
    provider: OPENAI_PROVIDER_ID,
    aliases: ["gpt 4o mini", "4o mini", GPT_4O_MINI_MODEL_ID],
    contextWindow: 128_000,
    maxOutputTokens: OPENAI_MAX_GENERATED_TOKENS,
    sourceUrl: "https://platform.openai.com/docs/models/gpt-4o-mini",
  },
  {
    id: "gpt-4",
    label: "GPT-4",
    provider: OPENAI_PROVIDER_ID,
    aliases: ["gpt 4"],
    contextWindow: 8_192,
    maxOutputTokens: 8_192,
    sourceUrl: "https://platform.openai.com/docs/models/gpt-4",
  },
  {
    id: O4_MINI_MODEL_ID,
    label: O4_MINI_MODEL_ID,
    provider: OPENAI_PROVIDER_ID,
    aliases: ["o4 mini", "o4mini"],
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    sourceUrl: "https://platform.openai.com/docs/models/o4-mini",
  },
];

export const OPENAI_MODEL_PROFILES: ModelProfile[] = [
  ...OPENAI_GPT5_MODEL_PROFILES,
  ...OPENAI_LEGACY_MODEL_PROFILES,
];
