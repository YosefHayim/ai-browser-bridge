import { ANTHROPIC_MODEL_PROFILES } from "@/domain/models/anthropic-profiles.ts";
import { GOOGLE_MODEL_PROFILES } from "@/domain/models/google-profiles.ts";
import type { ModelProfile } from "@/domain/models/model-profile-types.ts";
import { OPENAI_MODELS_URL } from "@/domain/models/model-urls.ts";
import { OPENAI_MODEL_PROFILES } from "@/domain/models/openai-profiles.ts";
import { ZAI_MODEL_PROFILES } from "@/domain/models/zai-profiles.ts";

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
