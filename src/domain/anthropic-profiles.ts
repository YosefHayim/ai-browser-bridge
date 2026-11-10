import type { ModelProfile } from "./model-profile-types.ts";
import { ANTHROPIC_MODELS_URL, ANTHROPIC_TOKEN_WINDOW_URL } from "./model-urls.ts";

const ANTHROPIC_MAX_GENERATED_TOKENS = 64_000;

const ANTHROPIC_PROVIDER_ID = "anthropic";

export const ANTHROPIC_MODEL_PROFILES: ModelProfile[] = [
  {
    id: "claude-4",
    label: "Claude 4 family",
    provider: ANTHROPIC_PROVIDER_ID,
    aliases: ["claude", "claude sonnet", "claude sonnet 4", "claude opus 4", "claude opus 4.1"],
    contextWindow: 200_000,
    maxOutputTokens: ANTHROPIC_MAX_GENERATED_TOKENS,
    sourceUrl: ANTHROPIC_MODELS_URL,
    note: "Anthropic lists 200K for current Claude text models.",
  },
  {
    id: "claude-sonnet-4-1m-beta",
    label: "Claude Sonnet 4 1M beta",
    provider: ANTHROPIC_PROVIDER_ID,
    aliases: ["claude 1m", "sonnet 1m", "claude sonnet 4 1m", "sonnet[1m]"],
    contextWindow: 1_000_000,
    maxOutputTokens: ANTHROPIC_MAX_GENERATED_TOKENS,
    sourceUrl: ANTHROPIC_TOKEN_WINDOW_URL,
    note: "Beta requires the context-1m-2025-08-07 header and eligible organization tier.",
  },
];
