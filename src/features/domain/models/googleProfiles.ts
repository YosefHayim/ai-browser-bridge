import type { ModelProfile } from "./modelProfileTypes.ts";
import { GEMINI_MODELS_URL } from "./modelUrls.ts";

/** Google Gemini model profiles. */
export const GOOGLE_MODEL_PROFILES: ModelProfile[] = [
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    provider: "google",
    aliases: ["gemini", "gemini flash", "2.5 flash", "flash"],
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    sourceUrl: GEMINI_MODELS_URL,
    note: "Gemini browser UI label; context window from Gemini API docs.",
  },
  {
    id: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    provider: "google",
    aliases: ["gemini pro", "2.5 pro", "pro"],
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    sourceUrl: GEMINI_MODELS_URL,
  },
  {
    id: "gemini-2.5-thinking",
    label: "Gemini 2.5 Thinking",
    provider: "google",
    aliases: ["gemini thinking", "2.5 thinking", "thinking"],
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    sourceUrl: GEMINI_MODELS_URL,
  },
  {
    id: "gemini-3-flash",
    label: "Gemini 3 Flash",
    provider: "google",
    aliases: ["gemini 3", "gemini 3 flash", "3 flash"],
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    sourceUrl: GEMINI_MODELS_URL,
  },
];
