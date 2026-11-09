import type { ModelProfile } from "./modelProfileTypes.ts";
import { OPENAI_MODELS_URL } from "./modelUrls.ts";
import { ANTHROPIC_MODEL_PROFILES } from "./profiles/anthropicProfiles.ts";
import { GOOGLE_MODEL_PROFILES } from "./profiles/googleProfiles.ts";
import { OPENAI_MODEL_PROFILES } from "./profiles/openaiProfiles.ts";
import { ZAI_MODEL_PROFILES } from "./profiles/zaiProfiles.ts";

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
  ...OPENAI_MODEL_PROFILES,
  ...ANTHROPIC_MODEL_PROFILES,
  ...ZAI_MODEL_PROFILES,
  ...GOOGLE_MODEL_PROFILES,
];
