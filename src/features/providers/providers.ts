import { type BridgeProviderId, DEFAULT_PROVIDER, PROVIDER_IDS } from "@/config";
import { arenaProvider } from "./arena/arenaPage.ts";
import type { BrowserProvider } from "./browserProvider.ts";
import { chatGptProvider } from "./chatgpt/chatgptPage.ts";
import { flowProvider } from "./flow/flowPage.ts";
import { geminiProvider } from "./gemini/geminiPage.ts";
import { UnknownProviderError } from "./providerErrors.ts";
import { selectorDrivenProvider } from "./selectorDrivenProvider.ts";

/**
 * Browser adapters keyed by id. Metadata + selectors come from `@/config` (the SSOT);
 * this binds each id to behavior — a bespoke `*Page` class for ChatGPT/Gemini, the
 * generic adapter otherwise. The `Record<BridgeProviderId, …>` annotation makes a
 * missing adapter a compile error.
 */
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

const isBridgeProviderId = (value: string): value is BridgeProviderId => {
  return (PROVIDER_IDS as readonly string[]).includes(value);
};

export const providerIdFrom = (input: string | undefined): BridgeProviderId => {
  if (input === undefined) return DEFAULT_PROVIDER;
  const providerId = input.trim();
  if (providerId.length === 0) return DEFAULT_PROVIDER;
  if (isBridgeProviderId(providerId)) return providerId;
  throw new UnknownProviderError({ value: providerId, validProviders: PROVIDER_IDS });
};

export const providerFor = (input: string | undefined): BrowserProvider => {
  return PROVIDER_ADAPTERS[providerIdFrom(input)];
};

export const providerIdsFrom = (input: string | undefined): BridgeProviderId[] => {
  if (input === undefined) return [DEFAULT_PROVIDER];
  if (input.trim().length === 0) return [DEFAULT_PROVIDER];
  const providerIds = input.split(",").map((part) => providerIdFrom(part));
  return [...new Set(providerIds)];
};
