import type { ModelProfile } from "./model-profile-types.ts";
import { GEMINI_MODELS_URL } from "./model-urls.ts";

const GOOGLE_MAX_GENERATED_TOKENS = 65_536;

const GOOGLE_TOKEN_WINDOW = 1_048_576;

const GOOGLE_PROVIDER_ID = "google";

export const GOOGLE_MODEL_PROFILES: ModelProfile[] = [
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    provider: GOOGLE_PROVIDER_ID,
    aliases: ["gemini", "gemini flash", "2.5 flash", "flash"],
    contextWindow: GOOGLE_TOKEN_WINDOW,
    maxOutputTokens: GOOGLE_MAX_GENERATED_TOKENS,
    sourceUrl: GEMINI_MODELS_URL,
    note: "Gemini browser UI label; context window from Gemini API docs.",
  },
  {
    id: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    provider: GOOGLE_PROVIDER_ID,
    aliases: ["gemini pro", "2.5 pro", "pro"],
    contextWindow: GOOGLE_TOKEN_WINDOW,
    maxOutputTokens: GOOGLE_MAX_GENERATED_TOKENS,
    sourceUrl: GEMINI_MODELS_URL,
  },
  {
    id: "gemini-2.5-thinking",
    label: "Gemini 2.5 Thinking",
    provider: GOOGLE_PROVIDER_ID,
    aliases: ["gemini thinking", "2.5 thinking", "thinking"],
    contextWindow: GOOGLE_TOKEN_WINDOW,
    maxOutputTokens: GOOGLE_MAX_GENERATED_TOKENS,
    sourceUrl: GEMINI_MODELS_URL,
  },
  {
    id: "gemini-3-flash",
    label: "Gemini 3 Flash",
    provider: GOOGLE_PROVIDER_ID,
    aliases: ["gemini 3", "gemini 3 flash", "3 flash"],
    contextWindow: GOOGLE_TOKEN_WINDOW,
    maxOutputTokens: GOOGLE_MAX_GENERATED_TOKENS,
    sourceUrl: GEMINI_MODELS_URL,
  },
];
