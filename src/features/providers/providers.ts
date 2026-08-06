import { type BridgeProviderId, DEFAULT_PROVIDER, PROVIDER_IDS } from "@/config";
import { arenaProvider } from "./arena/arenaPage.ts";
import type { BrowserProvider } from "./browserProvider.ts";
import { chatGptProvider } from "./chatgpt/chatgptPage.ts";
import { flowProvider } from "./flow/flowPage.ts";
import { geminiProvider } from "./gemini/geminiPage.ts";
import { UnknownProviderError } from "./providerErrors.ts";
import { selectorDrivenProvider } from "./selectorDrivenProvider.ts";

// Metadata and selectors live in `@/config`. This table binds each id to behavior.
// The Record annotation makes a missing adapter a compile error.
const PROVIDER_ADAPTERS: Record<BridgeProviderId, BrowserProvider> = {
  chatgpt: chatGptProvider,
  gemini: geminiProvider,
  claude: selectorDrivenProvider("claude"),
  deepseek: selectorDrivenProvider("deepseek"),
  grok: selectorDrivenProvider("grok"),
  perplexity: selectorDrivenProvider("perplexity"),
  flow: flowProvider,
  duck: selectorDrivenProvider("duck"),
  arena: arenaProvider,
};

const isBridgeProviderId = (providerId: string): providerId is BridgeProviderId => {
  return (PROVIDER_IDS as readonly string[]).includes(providerId);
};

export const providerIdFrom = (rawProviderId: string | undefined): BridgeProviderId => {
  if (rawProviderId === undefined) return DEFAULT_PROVIDER;
  const providerId = rawProviderId.trim();
  if (providerId.length === 0) return DEFAULT_PROVIDER;
  if (isBridgeProviderId(providerId)) return providerId;
  throw new UnknownProviderError({ value: providerId, validProviders: PROVIDER_IDS });
};

export const providerFor = (rawProviderId: string | undefined): BrowserProvider => {
  return PROVIDER_ADAPTERS[providerIdFrom(rawProviderId)];
};

export const providerIdsFrom = (rawProviderIds: string | undefined): BridgeProviderId[] => {
  if (rawProviderIds === undefined) return [DEFAULT_PROVIDER];
  if (rawProviderIds.trim().length === 0) return [DEFAULT_PROVIDER];
  const providerIds = rawProviderIds.split(",").map((segment) => providerIdFrom(segment));
  return [...new Set(providerIds)];
};
