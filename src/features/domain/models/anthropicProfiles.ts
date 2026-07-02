import type { ModelProfile } from "./modelProfileTypes.ts";
import { ANTHROPIC_CONTEXT_URL, ANTHROPIC_MODELS_URL } from "./modelUrls.ts";

/** Anthropic Claude model profiles. */
export const ANTHROPIC_MODEL_PROFILES: ModelProfile[] = [
  {
    id: "claude-4",
    label: "Claude 4 family",
    provider: "anthropic",
    aliases: ["claude", "claude sonnet", "claude sonnet 4", "claude opus 4", "claude opus 4.1"],
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    sourceUrl: ANTHROPIC_MODELS_URL,
    note: "Anthropic lists 200K for current Claude text models.",
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
];
