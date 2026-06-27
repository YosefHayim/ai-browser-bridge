import { CHATGPT_PROVIDER } from "./chatgpt-provider.config.ts";
import { GEMINI_PROVIDER } from "./gemini-provider.config.ts";
import type { BridgeProviderId, BrowserProvider } from "./browser-provider.types.ts";

const PROVIDERS: Record<BridgeProviderId, BrowserProvider> = {
  chatgpt: CHATGPT_PROVIDER,
  gemini: GEMINI_PROVIDER,
};

interface NormalizeProviderInput {
  /** Raw provider string from CLI or config. */
  value: string | undefined;
}

/** Normalize CLI/config provider strings to a supported id. */
export function normalizeProvider(input: NormalizeProviderInput | string | undefined): BridgeProviderId {
  const value = typeof input === "object" && input !== null && "value" in input ? input.value : input;
  if (value?.trim().toLowerCase() === "gemini") return "gemini";
  return "chatgpt";
}

interface GetProviderInput {
  /** Provider id or alias to resolve. */
  id: BridgeProviderId | string | undefined;
}

/** Resolve the browser adapter for a provider id. */
export function getBrowserProvider(input: GetProviderInput | BridgeProviderId | string | undefined): BrowserProvider {
  const id = typeof input === "object" && input !== null && "id" in input ? input.id : input;
  return PROVIDERS[normalizeProvider(id)];
}

export type { BridgeProviderId, BrowserProvider, ResponseWaitOptions } from "./browser-provider.types.ts";
