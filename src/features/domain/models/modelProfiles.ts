import { ANTHROPIC_MODEL_PROFILES } from "./anthropicProfiles.ts";
import { GOOGLE_MODEL_PROFILES } from "./googleProfiles.ts";
import type { ModelProfile } from "./modelProfileTypes.ts";
import { OPENAI_MODELS_URL } from "./modelUrls.ts";
import { OPENAI_MODEL_PROFILES } from "./openaiProfiles.ts";
import { ZAI_MODEL_PROFILES } from "./zaiProfiles.ts";

/** Fallback profile for browser-detected models without a stable id. */
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

/** All known model profiles in lookup order. */
export const MODEL_PROFILES: ModelProfile[] = [
  ...OPENAI_MODEL_PROFILES,
  ...ANTHROPIC_MODEL_PROFILES,
  ...ZAI_MODEL_PROFILES,
  ...GOOGLE_MODEL_PROFILES,
];
