import type { BrowserProvider } from "./browserProviderTypes.ts";
import { CHATGPT_PROVIDER } from "./chatgptProviderConfig.ts";
import { CLAUDE_PROVIDER } from "./claudeProviderConfig.ts";
import { DEEPSEEK_PROVIDER } from "./deepseekProviderConfig.ts";
import { GEMINI_PROVIDER } from "./geminiProviderConfig.ts";
import { GROK_PROVIDER } from "./grokProviderConfig.ts";
import { PERPLEXITY_PROVIDER } from "./perplexityProviderConfig.ts";
import { UnknownProviderError } from "./unknownProviderError.ts";

/**
 * Single source of truth for supported web-chat providers, keyed by id.
 * Adding a provider is one line here — the id type, the CLI `--provider` help, and
 * `bridge login` all derive from this object.
 */
export const PROVIDERS = {
  chatgpt: CHATGPT_PROVIDER,
  gemini: GEMINI_PROVIDER,
  claude: CLAUDE_PROVIDER,
  deepseek: DEEPSEEK_PROVIDER,
  grok: GROK_PROVIDER,
  perplexity: PERPLEXITY_PROVIDER,
} satisfies Record<string, BrowserProvider>;

/** Supported provider id — derived from the registry keys. */
export type BridgeProviderId = keyof typeof PROVIDERS;

/** All supported provider ids, in registry order. */
export const PROVIDER_IDS = Object.keys(PROVIDERS) as BridgeProviderId[];

/** Provider used when a command specifies none. */
export const DEFAULT_PROVIDER: BridgeProviderId = "chatgpt";

/** Human-typed aliases mapped to canonical ids. */
const PROVIDER_ALIASES: Record<string, BridgeProviderId> = {
  gpt: "chatgpt",
  "chat-gpt": "chatgpt",
  bard: "gemini",
  "claude.ai": "claude",
  anthropic: "claude",
  x: "grok",
  ppl: "perplexity",
};

function unwrapProvider(input: unknown): string | undefined {
  if (typeof input === "string") return input;
  if (input && typeof input === "object") {
    const record = input as { value?: unknown; id?: unknown };
    const raw = record.value ?? record.id;
    if (typeof raw === "string") return raw;
  }
  return undefined;
}

/**
 * Normalize a CLI/config provider string to a supported id.
 * Empty or absent → the default provider; an explicit unknown value throws
 * {@link UnknownProviderError} listing the valid ids (never silently coerced).
 */
export function normalizeProvider(
  input: string | { value?: string } | { id?: string } | undefined,
): BridgeProviderId {
  const value = unwrapProvider(input)?.trim().toLowerCase();
  if (!value) return DEFAULT_PROVIDER;
  const resolved = PROVIDER_ALIASES[value] ?? value;
  if (resolved in PROVIDERS) return resolved as BridgeProviderId;
  throw new UnknownProviderError(value, PROVIDER_IDS);
}

/** Resolve the browser adapter for a provider id/alias. */
export function getBrowserProvider(input: string | { id?: string } | undefined): BrowserProvider {
  return PROVIDERS[normalizeProvider(input)];
}

/**
 * Parse a `--provider` value into a deduped id list. Accepts a comma-separated list
 * (`claude,deepseek,grok`) for fan-out; empty/absent → the default provider. Each part
 * is normalized, so an unknown provider throws {@link UnknownProviderError}.
 */
export function parseProviderList(spec: string | undefined): BridgeProviderId[] {
  if (!spec?.trim()) return [DEFAULT_PROVIDER];
  const ids = spec.split(",").map((part) => normalizeProvider(part));
  return [...new Set(ids)];
}

export type { BrowserProvider, ResponseWaitOptions } from "./browserProviderTypes.ts";
export { UnknownProviderError } from "./unknownProviderError.ts";
